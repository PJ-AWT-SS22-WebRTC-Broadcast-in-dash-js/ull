FROM node:16

WORKDIR /usr/src/app
COPY package*.json ./
RUN apt update
RUN apt install -y ffmpeg
RUN yarn install
RUN npm install --global http-server
COPY . .
CMD [ "yarn", "start" ]
