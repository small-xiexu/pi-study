import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type ToolCall,
} from "@earendil-works/pi-ai";
import {
  createExtensionRuntime,
  ModelRuntime,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

export const TEST_PROVIDER = "pi-study-control";
export const TEST_MODEL_ID = "control-model";

const EMPTY_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export type ScriptedStream = (
  model: Model<Api>,
  context: Context,
  attempt: number,
) => AssistantMessageEventStream;

export function assistantMessage(
  model: Model<Api>,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

export function textStream(model: Model<Api>, text: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const pending = assistantMessage(model, [{ type: "text", text: "" }], "pending");
  const finalMessage = assistantMessage(model, [{ type: "text", text }], "stop");
  stream.push({ type: "start", partial: pending });
  stream.push({ type: "text_start", contentIndex: 0, partial: pending });
  stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: finalMessage });
  stream.push({ type: "text_end", contentIndex: 0, content: text, partial: finalMessage });
  stream.push({ type: "done", reason: "stop", message: finalMessage });
  stream.end(finalMessage);
  return stream;
}

export function toolCallStream(
  model: Model<Api>,
  toolName: string,
  argumentsValue: Record<string, unknown> = {},
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const toolCall: ToolCall = {
    type: "toolCall",
    id: `call-${Date.now()}`,
    name: toolName,
    arguments: argumentsValue,
  };
  const pending = assistantMessage(model, [toolCall], "pending");
  const finalMessage = assistantMessage(model, [toolCall], "toolUse");
  stream.push({ type: "start", partial: pending });
  stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
  stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: finalMessage });
  stream.push({ type: "done", reason: "toolUse", message: finalMessage });
  stream.end(finalMessage);
  return stream;
}

export function errorStream(model: Model<Api>, message: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const error = assistantMessage(model, [], "error", message);
  stream.push({ type: "error", reason: "error", error });
  stream.end(error);
  return stream;
}

export async function createScriptedRuntime(script: ScriptedStream): Promise<{
  modelRuntime: ModelRuntime;
  model: Model<Api>;
  getAttemptCount: () => number;
}> {
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  let attemptCount = 0;
  modelRuntime.registerProvider(TEST_PROVIDER, {
    name: "Pi Study Control Provider",
    api: "openai-responses",
    baseUrl: "http://127.0.0.1",
    apiKey: "pi-study-local-only",
    streamSimple: (model, context) => script(model, context, ++attemptCount),
    models: [
      {
        id: TEST_MODEL_ID,
        name: "Pi Study Control Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 1024,
      },
    ],
  });
  const model = modelRuntime.getModel(TEST_PROVIDER, TEST_MODEL_ID);
  if (!model) throw new Error("Scripted model was not registered");
  return { modelRuntime, model, getAttemptCount: () => attemptCount };
}

export function createEmptyResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "Follow the requested deterministic control-flow scenario.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export function contextText(context: Context): string {
  return context.messages
    .flatMap((message) => {
      if (typeof message.content === "string") return [message.content];
      return message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text);
    })
    .join("\n");
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
