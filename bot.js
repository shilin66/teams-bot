// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
const path = require('path');

const {ActivityHandler, MessageFactory} = require('botbuilder');
let fetch;
if (parseInt(process.versions.node.split('.')[0]) >= 14) {
    fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
} else {
    fetch = require('node-fetch');
}

const dotenv = require('dotenv');
// Import required bot configuration.
const ENV_FILE = path.join(__dirname, '.env');
dotenv.config({path: ENV_FILE});

class EchoBot extends ActivityHandler {
    constructor() {
        super();
        // See https://aka.ms/about-bot-activity-message to learn more about the message and other activity types.
        this.onMessage(async (context, next) => {
            try {

                console.log('==========================')
                const text= context.activity.text;
                console.log(JSON.stringify(context.activity, null, 2))
                console.log(text);
                let answer = "";
                const stream = true;
                const myHeaders = new Headers();
                myHeaders.append("Content-Type", "application/json");
                myHeaders.append("Authorization", "Bearer " + process.env.API_KEY);

                const raw = JSON.stringify({
                    "messages": [
                        {
                            role: "user",
                            content: text
                        }
                    ],
                    "stream": stream,
                    "chatId": context.activity.from.id
                });

                console.log(raw);
                const requestOptions = {
                    method: "POST",
                    headers: myHeaders,
                    body: raw
                };

                const response = await fetch(process.env.API_ENDPOINT, requestOptions);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                } else {
                    if (stream) {
                        // The response body is a ReadableStream. You can use an async iterator to read the data.
                        for await (const chunk of response.body) {
                            // Each chunk is a Uint8Array. Convert it to a string.
                            let text = new TextDecoder("utf-8").decode(chunk);

                            if (text.startsWith('data: ')) {
                                text = text.slice(6);
                            }
                            if (text === "[DONE]") {
                                break;
                            }
                            try {
                                let json_line = JSON.parse(text);
                                const message = json_line.choices[0];
                                if (message.delta.reasoning_content) {
                                    answer += message.delta.reasoning_content;
                                }
                                if (message.delta.content) {
                                    answer += message.delta.content;
                                }
                            } catch (err) {
                                console.error(err);
                            }

                        }
                    } else {
                        const json = await response.json();
                        if (json.choices[0].message.content) {
                            answer = json.choices[0].message.content;
                        }
                    }

                }

                console.log('>>>>>>>>>>>>>>>>>>>>>>>>>')
                console.log(answer);
                // Send the response back to the user
                await context.sendActivity(MessageFactory.text(answer, answer));
                // By calling next() you ensure that the next BotHandler is run.
                await next();
            } catch (err) {
                console.error(`${err}`);
                await context.sendActivity(MessageFactory.text(err));
            }


        });

        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded;
            const welcomeText = 'This is a bot that uses Azure OpenAI to generate responses.';
            for (let cnt = 0; cnt < membersAdded.length; ++cnt) {
                if (membersAdded[cnt].id !== context.activity.recipient.id) {
                    await context.sendActivity(MessageFactory.text(welcomeText, welcomeText));
                }
            }
            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });
    }
}

module.exports.EchoBot = EchoBot;