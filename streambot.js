const { ActivityHandler, MessageFactory, CardFactory } = require('botbuilder');
const { StreamType, ChannelData } = require('./models'); // Models for streaming
let fetch;
if (parseInt(process.versions.node.split('.')[0]) >= 14) {
    fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
} else {
    fetch = require('node-fetch');
}
class TeamsStreamingBot extends ActivityHandler {
    constructor() {
        super();
        this.isCancelled = false;
        this.abortController = new AbortController();
    }

    // Handle incoming messages
    async onMessageActivity(turnContext) {
        this.isCancelled = false;
        this.abortController = new AbortController();
        let userInput = turnContext.activity.text.trim().toLowerCase();
        try {
            let contentBuilder = '';
            let finalContentBuilder = '';
            let streamSequence = 1;
            const rps = 1000;

            // Prepare the initial informative message
            let channelData = new ChannelData({
                streamType: StreamType.Informative, // Indicating this is the start of the stream
                streamSequence: streamSequence,
            });

            // Build and send an initial streaming activity
            let streamId = await this.buildAndSendStreamingActivity(turnContext, "Getting the information...", '', channelData);


            const raw = JSON.stringify({
                "messages": [
                    {
                        role: "user",
                        content: userInput
                    }
                ],
                "stream": true,
                "detail": true,
                "chatId": turnContext.activity.from.name
            });
            const myHeaders = new Headers();
            myHeaders.append("Content-Type", "application/json");
            myHeaders.append("Authorization", "Bearer " + process.env.API_KEY);

            const requestOptions = {
                method: "POST",
                headers: myHeaders,
                body: raw,
                signal: this.abortController.signal
            };
            const baseURL = process.env.API_URL;
            const response = await fetch(`${baseURL}/api/v1/chat/completions`, requestOptions);

            const stopwatch = new Date();


            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            } else {
                for await (const chunk of response.body) {
                    if  (this.isCancelled) {
                        break;
                    }
                    // Each chunk is a Uint8Array. Convert it to a string.
                    let text = new TextDecoder("utf-8").decode(chunk);
                    const lines = text.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].trim() === '') {
                            continue;
                        }
                        let event= '';
                        let dataStr  =  '';
                        if (lines[i].startsWith('event: ')) {
                            event = lines[i].replace('event:', '').trim();
                            i++;
                        }
                        if (lines[i].startsWith('data: ')) {
                            dataStr = lines[i].replace('data:', '').trim();
                        }

                        if (event.trim() === 'flowResponses') {
                            streamSequence++
                            channelData.streamType = StreamType.Final; // Mark the stream as finished
                            channelData.streamSequence = streamSequence;
                            channelData.streamId = streamId;
                            console.log('finalContentBuilder>>>>>', finalContentBuilder);
                            const answer=  finalContentBuilder ? finalContentBuilder : contentBuilder;
                            await this.buildAndSendStreamingActivity(turnContext, contentBuilder, answer, channelData);
                            break;
                        }

                        if (event === 'answer') {
                            if (dataStr.trim() === '[DONE]') {
                                streamSequence++
                                channelData.streamType = StreamType.Streaming;
                                channelData.streamSequence = streamSequence;
                                channelData.streamId = streamId;
                                await this.buildAndSendStreamingActivity(turnContext, contentBuilder, '', channelData);
                                stopwatch.setTime(new Date().getTime());
                                continue;
                            }
                            let json_line = JSON.parse(dataStr);
                            const message = json_line.choices[0];
                            if (message.delta.reasoning_content) {
                                contentBuilder += message.delta.reasoning_content;
                            }
                            if (message.delta.content) {
                                contentBuilder += message.delta.content;
                                finalContentBuilder += message.delta.content;
                            }

                            // If RPS rate reached, send the current content chunk
                            if (contentBuilder.length > 0 && new Date() - stopwatch > rps) {
                                // 检查是否存在未闭合的 Markdown 图片语法
                                // 匹配以 "![" 开始但还没出现 "](" 或者已经出现 "](" 但没出现 ")" 的情况
                                // const incompleteImagePattern = /!\[[^\]]*$|!\[[^\]]+\]\([^)]*$/;
                                // if (incompleteImagePattern.test(contentBuilder)) {
                                //     // 如果检测到未闭合的图片链接，跳过本次发送，等待更多 chunk
                                //     continue;
                                // }

                                // 此时所有图片链接都是完整的，先替换相对路径再发送
                                // contentBuilder = contentBuilder.replace(
                                //     /(?<!https?:\/\/[^\s]*)(?:\/api\/system\/img\/[^\s.]*\.[^\s]*)/g,
                                //     (match) => `${baseURL}${match}`
                                // );
                                streamSequence++
                                channelData.streamType = StreamType.Streaming; // Indicating this is a streaming update
                                channelData.streamSequence = streamSequence;
                                channelData.streamId = streamId;
                                await this.buildAndSendStreamingActivity(turnContext, contentBuilder,  '', channelData);
                                stopwatch.setTime(new Date().getTime()); // Reset the stopwatch after sending a chunk
                            }
                        }
                    }

                }
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Fetch request was aborted');
                return;
            }
            // In case of an error, send the error message to the user
            await turnContext.sendActivity(error.message || "An error occurred during streaming.");
        }
    }

    // Build and send a streaming activity (either ongoing or final)
    async buildAndSendStreamingActivity(turnContext, typingContent, finalContent, channelData) {
        const isStreamFinal = channelData.streamType === StreamType.Final; // Check if this is the final part of the stream

        // Set up the basic streaming activity (either typing or a message)
        const streamingActivity = {
            type: isStreamFinal ? 'message' : 'typing', // 'typing' indicates the bot is working, 'message' when final
            id: channelData.streamId
        };

        // If there is typingContent content, add it to the activity
        if (typingContent) {
            streamingActivity.text = typingContent;
        }

        // Add the streaming information as an entity
        streamingActivity.entities = [{
            type: 'streaminfo',
            streamId: channelData.streamId,
            streamType: channelData.streamType.toString(),
            streamSequence: channelData.streamSequence
        }];

        // If it's the final stream, attach an AdaptiveCard with the result
        if (isStreamFinal) {
            try {
                const cardJson = {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "version": "1.5",
                    "type": "AdaptiveCard",
                    "body": [
                        {
                            "type": "TextBlock",
                            "wrap": true,
                            "text": finalContent
                        }
                    ]
                };
                await this.sendStreamingActivity(turnContext, streamingActivity);
                await turnContext.sendActivity(MessageFactory.text(finalContent, finalContent));
                return await turnContext.deleteActivity(channelData.streamId);
                // return await turnContext.sendActivity({attachments: [CardFactory.adaptiveCard(cardJson)]});
            } catch (error) {
                console.error("Error creating adaptive card:", error);
                await turnContext.sendActivity("Error while generating the adaptive card.");
            }
        }

        return await this.sendStreamingActivity(turnContext, streamingActivity);

    }

    // Send the streaming activity to the user
    async sendStreamingActivity(turnContext, streamingActivity) {
        try {
            const response = await turnContext.sendActivity(streamingActivity);
            return response.id; // Return the activity ID for tracking
        } catch (error) {
            if (await this.isContentStreamNotAllowed(error)) {
                console.log(`用户停止了流式推送`);
                this.isCancelled = true;
                this.abortController.abort();
            } else {
                // If an error occurs during sending, inform the user
                await turnContext.sendActivity(MessageFactory.text("Error while sending streaming activity: " + error.message));
                throw new Error("Error sending activity: " + error.message); // Propagate error
            }
        }
    }

    async onInstallationUpdateActivity(turnContext) {
        // Check if the activity is from a channel (group chat) or one-on-one
        if (turnContext.activity.conversation.conversationType === 'channel') {
            // Streaming is not yet supported in channels or group chats
            await turnContext.sendActivity("Welcome to AI bot! Unfortunately, streaming is not yet available for channels or group chats.");
        } else {
            // In one-on-one conversations, the bot can be used
            await turnContext.sendActivity("Welcome to AI bot! You can ask me a question and I'll do my best to answer it.");
        }
    }

    async isContentStreamNotAllowed(error) {
        return error.statusCode === 403
            && error.code === 'ContentStreamNotAllowed';
    }
}

// Export the bot class
module.exports.TeamsStreamingBot = TeamsStreamingBot;