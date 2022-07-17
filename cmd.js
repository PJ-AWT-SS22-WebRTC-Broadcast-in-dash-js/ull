module.exports = [
  `-re`,
  `-f`, `lavfi`,
  `-pix_fmt`, `yuv420p`,
  `-map`, `0:v`,
  `-map`, `0:a`,
  `-c:a`, `aac`,
  `-c:v`, `libx264`, 
  `-tune`, `zerolatency`, 
  `-profile:v`, `high`, 
  `-preset`, `veryfast`, 
  `-bf`, `0`, 
  `-refs`, `3`, 
  `-sc_threshold`, `0`,
  `-g`, `144`,
  `-keyint_min`, `144`,
  `-b:v`, `400k`,
  `-vf`, `fps=24,drawtext=box=1:fontcolor=black:boxcolor=white:fontsize=100':x=40:y=400:textfile=utils/text.txt`,
  `-method`, `PUT`,
  `-seg_duration`, `6`,
  `-streaming`, `1`,
  `-http_persistent`, `1`,
  `-index_correction`, `1`,
  `-use_timeline`, `0`,
  `-media_seg_name`, `chunk-stream-$RepresentationID$-$Number%05d$.m4s`,
  `-init_seg_name`, `init-stream-$RepresentationID$.m4s`,
  `-window_size`, `5`,
  `-extra_window_size`, `10`,
  `-adaptation_sets`, `id=0,streams=v id=1,streams=a`,
  `-f`, `dash`,
  `output/manifest.mpd`
]
