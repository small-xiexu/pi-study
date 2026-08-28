import path from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { findRealRunContractViolations, SafeEventRecorder } from "./safe-event-trace.ts";

const PROVIDER_ID = "openai";
const MODEL_ID = "gpt-5.6-sol";
const FIXTURE_PATH = "labs/7.1-sdk/fixture.txt";
const EXPECTED_MARKER = "SDK_REAL_MODEL_MARKER_7101";

const labDirectory = import.meta.dirname;
const repositoryRoot = path.resolve(labDirectory, "../..");
const agentDirectory = getAgentDir();

const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: false },
});

const resourceLoader = new DefaultResourceLoader({
  cwd: repositoryRoot,
  agentDir: agentDirectory,
  settingsManager,
  noExtensions: true,
});
await resourceLoader.reload();

const agentsFiles = resourceLoader.getAgentsFiles().agentsFiles;
const skills = resourceLoader.getSkills();
const prompts = resourceLoader.getPrompts();
const themes = resourceLoader.getThemes();
const projectAgentsLoaded = agentsFiles.some(
  (file) => path.resolve(file.path) === path.join(repositoryRoot, "AGENTS.md"),
);

console.log(
  JSON.stringify({
    kind: "resources",
    projectAgentsLoaded,
    contextFileCount: agentsFiles.length,
    skillCount: skills.skills.length,
    promptCount: prompts.prompts.length,
    themeCount: themes.themes.length,
    diagnosticCount:
      skills.diagnostics.length + prompts.diagnostics.length + themes.diagnostics.length,
    extensionsDisabled: true,
  }),
);

if (!projectAgentsLoaded) {
  throw new Error("Project AGENTS.md was not discovered by DefaultResourceLoader");
}

const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
const availableModels = await modelRuntime.getAvailable(PROVIDER_ID);
const selectedModel = availableModels.find((model) => model.id === MODEL_ID);
if (!selectedModel) {
  throw new Error(`Configured model is unavailable: ${PROVIDER_ID}/${MODEL_ID}`);
}

console.log(
  JSON.stringify({
    kind: "model",
    provider: selectedModel.provider,
    model: selectedModel.id,
    api: selectedModel.api,
    thinkingLevel: "off",
  }),
);

const { session, extensionsResult, modelFallbackMessage } = await createAgentSession({
  cwd: repositoryRoot,
  agentDir: agentDirectory,
  model: selectedModel,
  thinkingLevel: "off",
  modelRuntime,
  resourceLoader,
  tools: ["read"],
  sessionManager: SessionManager.inMemory(repositoryRoot),
  settingsManager,
});

if (extensionsResult.errors.length > 0) {
  throw new Error(`Unexpected extension load errors: ${extensionsResult.errors.length}`);
}
if (modelFallbackMessage) {
  throw new Error(`Unexpected model fallback: ${modelFallbackMessage}`);
}

const recorder = new SafeEventRecorder();
const unsubscribe = session.subscribe((event) => {
  const record = recorder.record(event);
  console.log(JSON.stringify({ kind: "event", ...record }));
});

try {
  await session.prompt(
    [
      `Use the read tool exactly once to read ${FIXTURE_PATH}.`,
      "Do not use any other tool.",
      "Then reply with exactly the marker text from the file, without Markdown or explanation.",
    ].join(" "),
  );

  const lastAssistant = [...session.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const finalText =
    lastAssistant?.role === "assistant"
      ? lastAssistant.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
          .trim()
      : "";
  const contractViolations = findRealRunContractViolations(recorder.records);
  const markerSeen = finalText.includes(EXPECTED_MARKER);

  console.log(
    JSON.stringify({
      kind: "result",
      markerSeen,
      finalText,
      messageCount: session.messages.length,
      eventCount: recorder.records.length,
      contractViolations,
    }),
  );

  if (!markerSeen || contractViolations.length > 0) {
    process.exitCode = 1;
  }
} finally {
  unsubscribe();
  session.dispose();
}
