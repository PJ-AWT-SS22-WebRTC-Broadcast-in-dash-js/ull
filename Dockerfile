FROM node:16

WORKDIR /usr/src/app
COPY package*.json ./
RUN yarn install
COPY . .
CMD [ "yarn", "start" ]
CMD [ "http-server", "--cors" "./output" ]
