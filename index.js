const fs = require('fs')
const express = require('express')
const cors = require('cors')
const compression = require('compression')
const childProcess = require('child_process')
const config = require('./cmd')
const http = require('http')
const { Server } = require("socket.io")

const CACHE_DURATION = 3000 * 1000
const TIME_SLEEP_MS = 50
const MAX_SLEEP_COUNT = 1000 / TIME_SLEEP_MS * 10
const PORT = 3104

class UllServer {
  start () {
    this.app = express()
    this.app.use(cors())
    this.app.use(express.json());
    this.app.use(compression())
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*"
      }
    })
    this.cache = {}
    this.listen()
  }

  listen () {
    this.acceptUpload()
    this.acceptDownload()

    /*
    this.app.post('/start', (req, res, next) => {
      if (this.instance) {
        return res.status(200).json({ message: 'already started' })
      }
      console.log(req.body)
      this.startTranscoding(req.body.videoname, req.body.save)

      return res.status(200).json({ message: `started manifest is at http://localhost:${PORT}/manifest.mpd` })
    })
    */

    this.io.on('connection', (socket) => {
      console.log('a user connected');

      socket.on('disconnect', (reason) => {
        console.log('user disconnected because of the following reason: ' + reason);
        if (this.instance) {
          this.instance.kill("SIGINT");
        }
      });
      socket.on('data', (data) => {
        console.log("[data]", data);
        if (this.instance) {
          this.instance.stdin.write(data);
        }
      });
      socket.on('webrtclink', (data) => {
        console.log("webrtc link: ", data);
        if (this.instance) {
          this.webrtcLink = data;
          this.readWriteAsync();
        }
      });
    });

    this.app.post('/stop', (req, res, next) => {
      if (!this.instance) {
        return res.status(200).json({ message: 'already stopped' })
      }
      this.stopTranscoding()
      return res.status(200).json({ message: 'stopped' })
    })

    this.server.listen(PORT, () => {
      console.log('ULL server listening... port', PORT, 'POST to /start to start the transcoder')
    })

    this.startTranscoding("-", "1");
  }

  startTranscoding (videoname, save) {
    // Add the videoname into config as input
    config.splice(1, 0, "-i")
    config.splice(2, 0, videoname)
    // Save the mpd files
    if (save != "1") {
        config.splice(-5, 0, `-remove_at_exit`)
        config.splice(-5, 0, `1`)
    }
    console.log(config)

    this.instance = childProcess.spawn('ffmpeg', config)
    let isFirstData = true
    this.instance.stderr.on('data', data => {
      if (isFirstData) {
        console.log('ffmpeg started')
        isFirstData = false
      }
    })

    this.instance.stdout.on('data', (data) => 
        console.log("STDOUT: ", data.toString())
    );
    this.instance.stderr.on('data', (data) => 
        console.log("STDERR: ", data.toString())
    );
    this.instance.stdin.on('error', (e) => {
      console.log('FFmpeg STDIN Error', e);
    });

    this.instance.on('close', (code) => {
      console.log('ffmpeg closed')
      console.log(`child process close all stdio with code ${code}`);
    })

    this.watchManifest()

    // Spawn an http-server to serve chunks and manifest
    const httpServerConfig = ["output", "--cors"]
    this.chunkServer = childProcess.spawn('http-server', httpServerConfig)
  }

  stopTranscoding () {
    this.instance.kill()
    this.instance = undefined
  }

  acceptUpload () {
    this.app.put('/:filename', (req, res, next) => {
      const { filename } = req.params

      try {
        if (!this.isCached(filename) || this.isPlaylist(filename)) {
          this.resetFileCache(filename)
        }
      } catch (e) {
        return res.status(400).send()
      }

      req.on('data', chunk => {
        try {
          this.cacheChunk(filename, chunk)
        } catch (e) {
          return res.status(400).send()
        }
      })

      req.on('end', () => {
        try {
          if (this.isTempCached(filename)) {
            this.scheduleClearCache(filename)
          }

          this.setDone(filename)

          console.log('Upload complete', filename)
          if (!this.isPlaylist(filename)) {
            res.end()
          }
        } catch (e) {
          return res.status(400).send()
        }
      })
    })
  }

  readWriteAsync() {
    fs.readFile('webrtc_template.txt', 'utf-8', (err, data) => {
      if (err) throw err;

      let newValue = data.replace("channel_url", this.webrtcLink);

      fs.writeFile('webrtc_template.txt', newValue, 'utf-8', (err) => {
        if (err) throw err;
        console.log('WebRTC link is updated.');
      });
    });
  }

  watchManifest() {
    fs.watchFile("./output/manifest.mpd", (eventType, filename) => {
      this.addWebRTClink2Manifest();
    });
  }

  addWebRTClink2Manifest() {
    fs.readFile('./output/manifest.mpd', 'utf-8', (err, data) => {
      if (err) throw err;

      let newValue = data.replace("</Period>", 
        "\t<AdaptationSet mimeType=\"video RTP/AVP\" \n\t\t\t" + "xlink:rel=\"urn:ietf:params:whip:whpp\"\n\t\t\txlink:href=\"" 
          + this.webrtcLink + "\"\n\t\t" + "></AdaptationSet>\n\t</Period>");

      fs.writeFile('./output/manifestWebrtc.mpd', newValue, 'utf-8', (err) => {
        if (err) throw err;
        console.log('WebRTC link in manifest.mpd is updated.');
      });
    });
  
  }

  isCached (filename) {
    return !!this.cache[filename]
  }

  isChunk (filename) {
    return filename.startsWith('chunk') && filename.endsWith('.m4s')
  }

  isSegment (filename) {
    return filename.endsWith('.m4s')
  }

  isPlaylist (filename) {
    return filename.endsWith('.mpd')
  }

  isTempCached (filename) {
    return filename.startsWith('chunk')
  }

  scheduleClearCache (filename) {
    setTimeout(() => {
      this.clearFileCache(filename)
    }, CACHE_DURATION)
  }

  clearFileCache (filename) {
    delete this.cache[filename]
  }

  resetFileCache (filename) {
    this.cache[filename] = {
      done: false,
      chunks: []
    }
  }

  cacheChunk (filename, chunk) {
    this.cache[filename].chunks.push(chunk)
  }

  getChunks (filename) {
    return this.cache[filename].chunks
  }

  setDone (filename) {
    this.cache[filename].done = true
  }

  isDone (filename) {
    return this.isCached(filename) && this.cache[filename].done === true
  }

  async sleep () {
    return new Promise(resolve => setTimeout(resolve, TIME_SLEEP_MS))
  }

  acceptDownload () {
    this.app.get('/healthcheck', (req, res) => {
      res.status(200).json({ message: 'OK' })
    })

    this.app.get('/:filename', async (req, res, next) => {
      try {
        const { filename } = req.params
        res.set('Transfer-Encoding', 'chunked')

        if (this.isSegment(filename)) {
          res.set('Content-Type', 'video/mp4')
          res.set('Cache-Control', 'max-age=31536000')
        }

        if (this.isPlaylist(filename)) {
          res.set('Content-Type', 'application/dash+xml')
        }

        let idx = 0
        let sleepCt = 0
        while (!this.isDone(filename)) {
          if (sleepCt > MAX_SLEEP_COUNT) {
            throw new Error('max sleep count reached')
          }
          if (!this.isCached(filename)) {
            await this.sleep()
            sleepCt++
            continue
          }

          const chunks = this.getChunks(filename).slice(idx)
          const length = chunks.length
          if (length === 0) {
            await this.sleep()
            sleepCt++
            continue
          }
          idx += length
          const buffer = Buffer.concat(chunks)
          res.write(buffer)
          res.flush()
          await this.sleep()
          sleepCt++
        }

        const chunks = this.getChunks(filename).slice(idx)
        const length = chunks.length
        if (length === 0) {
          res.end()
          return
        }
        console.log('Download complete', filename)
        const buffer = Buffer.concat(chunks)
        res.write(buffer)
        res.flush()
        res.end()
      } catch (e) {
        console.log(e)
        return res.status(400).send()
      }
    })
  }

  stop () {
    this.server.close()
  }


}

const server = new UllServer()
server.start()
