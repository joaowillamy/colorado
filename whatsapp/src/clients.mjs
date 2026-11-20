// Clients criados FORA do handler: a Lambda reaproveita entre invocações
// (conexões HTTP abertas, menos cold start).

import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockAgentRuntimeClient } from "@aws-sdk/client-bedrock-agent-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SocialMessagingClient } from "@aws-sdk/client-socialmessaging";
import { config } from "./config.mjs";

const { region } = config;

export const bedrock = new BedrockRuntimeClient({ region });
export const bedrockKb = new BedrockAgentRuntimeClient({ region });
export const social = new SocialMessagingClient({ region });
export const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});
