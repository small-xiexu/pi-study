package com.xiexu.pistudy.rpc;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Pi RPC 子进程客户端
 *
 * 职责：管理长期 Pi 子进程、严格 JSONL、Response 关联和单活动 Prompt 状态机
 *
 * @author xiexu
 */
public final class PiRpcClient implements AutoCloseable {

    private static final Duration CLOSE_TIMEOUT = Duration.ofSeconds(5);
    private static final AtomicInteger THREAD_SEQUENCE = new AtomicInteger();

    private final List<String> command;
    private final File workingDirectory;
    private final ObjectMapper objectMapper;
    private final AtomicLong requestSequence = new AtomicLong();
    private final Map<String, CompletableFuture<JsonNode>> pendingResponses = new ConcurrentHashMap<String, CompletableFuture<JsonNode>>();
    private final List<RpcEventListener> eventListeners = new CopyOnWriteArrayList<RpcEventListener>();
    private final AtomicReference<PromptTracker> activePrompt = new AtomicReference<PromptTracker>();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final CompletableFuture<Void> stdoutClosed = new CompletableFuture<Void>();
    private final CompletableFuture<Integer> processExitCode = new CompletableFuture<Integer>();
    private final ExecutorService ioExecutor = Executors.newFixedThreadPool(3, new RpcThreadFactory());
    private final Object writerLock = new Object();

    private volatile Process process;
    private volatile BufferedWriter stdinWriter;

    /**
     * 创建 Pi RPC 客户端
     *
     * @param command 子进程命令及参数
     * @param workingDirectory 子进程工作目录
     */
    public PiRpcClient(List<String> command, File workingDirectory) {
        if (command == null || command.isEmpty()) {
            throw new IllegalArgumentException("command must not be empty");
        }
        this.command = Collections.unmodifiableList(new ArrayList<String>(command));
        this.workingDirectory = Objects.requireNonNull(workingDirectory, "workingDirectory");
        this.objectMapper = new ObjectMapper();
        this.objectMapper.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    /**
     * 启动长期运行的 RPC 子进程和三个 I/O 任务
     *
     * @throws IOException 子进程无法启动
     */
    public synchronized void start() throws IOException {
        if (!started.compareAndSet(false, true)) {
            throw new IllegalStateException("RPC client has already been started");
        }
        ProcessBuilder processBuilder = new ProcessBuilder(command);
        processBuilder.directory(workingDirectory);
        processBuilder.redirectErrorStream(false);
        process = processBuilder.start();
        stdinWriter = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
        ioExecutor.execute(this::readStdout);
        ioExecutor.execute(this::drainStderr);
        ioExecutor.execute(this::watchProcessExit);
    }

    /**
     * 注册异步 Agent Event 监听器
     *
     * @param listener 事件监听器
     */
    public void addEventListener(RpcEventListener listener) {
        eventListeners.add(Objects.requireNonNull(listener, "listener"));
    }

    /**
     * 移除异步 Agent Event 监听器
     *
     * @param listener 事件监听器
     */
    public void removeEventListener(RpcEventListener listener) {
        eventListeners.remove(listener);
    }

    /**
     * 发送普通 RPC Command 并异步等待同 ID Response
     *
     * @param commandNode 不包含 id 的 Command JSON
     * @return Response Future
     * @throws IOException Command 无效或写入失败
     */
    public CompletableFuture<JsonNode> sendCommand(ObjectNode commandNode) throws IOException {
        ensureRunning();
        Objects.requireNonNull(commandNode, "commandNode");
        String type = commandNode.path("type").asText("");
        if (type.isEmpty()) {
            throw new RpcProtocolException("RPC command requires a type");
        }
        String requestId = "java-" + requestSequence.incrementAndGet();
        ObjectNode request = commandNode.deepCopy();
        request.put("id", requestId);
        CompletableFuture<JsonNode> responseFuture = new CompletableFuture<JsonNode>();
        CompletableFuture<JsonNode> existing = pendingResponses.putIfAbsent(requestId, responseFuture);
        if (existing != null) {
            throw new RpcProtocolException("Duplicate RPC request id");
        }
        try {
            writeRecord(request);
            return responseFuture;
        } catch (IOException exception) {
            pendingResponses.remove(requestId, responseFuture);
            responseFuture.completeExceptionally(exception);
            throw exception;
        }
    }

    /**
     * 提交一个 Prompt 并等待命令 Response 与 Agent settled
     *
     * @param message Prompt 文本
     * @param timeout 整个接收和运行等待上限
     * @return 分层 Prompt 结果
     * @throws IOException RPC I/O 或协议异常
     * @throws InterruptedException 当前线程被中断
     * @throws TimeoutException 等待超时
     */
    public PromptRunResult runPrompt(String message, Duration timeout)
            throws IOException, InterruptedException, TimeoutException {
        Objects.requireNonNull(message, "message");
        validateTimeout(timeout);
        PromptTracker tracker = new PromptTracker();
        if (!activePrompt.compareAndSet(null, tracker)) {
            throw new IllegalStateException("Only one active Prompt run is supported");
        }
        tracker.getCompletion().whenComplete((result, failure) -> activePrompt.compareAndSet(tracker, null));
        long deadlineNanos = System.nanoTime() + timeout.toNanos();
        ObjectNode promptCommand = objectMapper.createObjectNode();
        promptCommand.put("type", "prompt");
        promptCommand.put("message", message);
        CompletableFuture<JsonNode> responseFuture;
        try {
            responseFuture = sendCommand(promptCommand);
        } catch (IOException exception) {
            activePrompt.compareAndSet(tracker, null);
            throw exception;
        }

        JsonNode response;
        try {
            response = await(responseFuture, deadlineNanos);
        } catch (IOException exception) {
            PromptRunResult completed = tracker.getCompletedResult();
            if (completed != null) {
                return completed;
            }
            throw exception;
        }
        if (!response.path("success").asBoolean(false)) {
            tracker.markRejected(response.path("error").asText("RPC prompt was rejected"));
        } else {
            tracker.markAccepted();
        }
        return await(tracker.getCompletion(), deadlineNanos);
    }

    /**
     * 等待 RPC 子进程退出
     *
     * @param timeout 等待上限
     * @return 子进程退出码
     * @throws IOException 退出等待失败
     * @throws InterruptedException 当前线程被中断
     * @throws TimeoutException 等待超时
     */
    public int awaitExit(Duration timeout) throws IOException, InterruptedException, TimeoutException {
        validateTimeout(timeout);
        long deadlineNanos = System.nanoTime() + timeout.toNanos();
        return await(processExitCode, deadlineNanos);
    }

    /**
     * 返回客户端是否已启动且子进程尚未退出
     *
     * @return 子进程是否仍在运行
     */
    public boolean isRunning() {
        Process currentProcess = process;
        return started.get() && !closed.get() && currentProcess != null && currentProcess.isAlive();
    }

    /**
     * 关闭 stdin 触发 Pi 正常退出，并在超时后升级终止
     *
     * @throws IOException 关闭输入或等待退出失败
     */
    @Override
    public void close() throws IOException {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        IOException closeFailure = null;
        BufferedWriter writer = stdinWriter;
        if (writer != null) {
            try {
                writer.close();
            } catch (IOException exception) {
                closeFailure = exception;
            }
        }
        Process currentProcess = process;
        if (currentProcess != null) {
            stopProcess(currentProcess);
        }
        ioExecutor.shutdown();
        try {
            if (!ioExecutor.awaitTermination(CLOSE_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS)) {
                ioExecutor.shutdownNow();
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            ioExecutor.shutdownNow();
            throw new IOException("Interrupted while closing RPC client", exception);
        }
        if (closeFailure != null) {
            throw closeFailure;
        }
    }

    /**
     * 写入一个 JSONL 记录并立即 flush
     *
     * @param record JSON 记录
     * @throws IOException 序列化或写入失败
     */
    private void writeRecord(JsonNode record) throws IOException {
        String json = objectMapper.writeValueAsString(record);
        synchronized (writerLock) {
            ensureRunning();
            stdinWriter.write(json);
            stdinWriter.write('\n');
            stdinWriter.flush();
        }
    }

    /**
     * 持续读取 stdout JSONL 并分发记录
     */
    private void readStdout() {
        try {
            StrictJsonlReader.read(process.getInputStream(), this::handleRecordUnchecked);
            stdoutClosed.complete(null);
        } catch (UncheckedIOException exception) {
            IOException cause = exception.getCause();
            stdoutClosed.completeExceptionally(cause);
            handleTransportFailure(cause);
        } catch (IOException exception) {
            stdoutClosed.completeExceptionally(exception);
            handleTransportFailure(exception);
        } catch (RuntimeException exception) {
            RpcProtocolException protocolException = new RpcProtocolException("RPC stdout handler failed", exception);
            stdoutClosed.completeExceptionally(protocolException);
            handleTransportFailure(protocolException);
        }
    }

    /**
     * 解析单条 stdout 记录，并把受检异常转换为流读取异常
     *
     * @param line 单条 JSONL 记录
     */
    private void handleRecordUnchecked(String line) {
        try {
            JsonNode record = objectMapper.readTree(line);
            if (record == null || !record.isObject()) {
                throw new RpcProtocolException("RPC stdout record must be a JSON object");
            }
            String type = record.path("type").asText("");
            if ("response".equals(type)) {
                handleResponse(record);
            } else {
                handleEvent(record);
            }
        } catch (JsonProcessingException exception) {
            throw new UncheckedIOException(new RpcProtocolException("RPC stdout contains invalid JSON", exception));
        } catch (RpcProtocolException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    /**
     * 按请求 ID 完成对应 Command Response
     *
     * @param response Response JSON
     */
    private void handleResponse(JsonNode response) {
        String requestId = response.path("id").asText("");
        if (requestId.isEmpty()) {
            return;
        }
        CompletableFuture<JsonNode> responseFuture = pendingResponses.remove(requestId);
        if (responseFuture != null) {
            responseFuture.complete(response);
        }
    }

    /**
     * 分发异步 Event 并推进活动 Prompt 状态机
     *
     * @param event Event JSON
     */
    private void handleEvent(JsonNode event) {
        for (RpcEventListener listener : eventListeners) {
            listener.onEvent(event);
        }
        PromptTracker tracker = activePrompt.get();
        if (tracker != null) {
            tracker.onEvent(event);
        }
    }

    /**
     * 持续排空 stderr，防止子进程因管道背压阻塞
     */
    private void drainStderr() {
        InputStream errorStream = process.getErrorStream();
        byte[] buffer = new byte[4096];
        try {
            while (errorStream.read(buffer) != -1) {
                // stderr 只排空不记录，避免扩散 Provider 或环境诊断内容。
            }
        } catch (IOException exception) {
            if (!closed.get()) {
                handleTransportFailure(new RpcProtocolException("Failed to drain RPC stderr", exception));
            }
        }
    }

    /**
     * 等待子进程退出，并在 stdout 排空后发布退出结果
     */
    private void watchProcessExit() {
        int exitCode;
        try {
            exitCode = process.waitFor();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return;
        }
        stdoutClosed.whenComplete((ignored, failure) -> handleProcessExit(exitCode));
    }

    /**
     * 发布子进程退出并完成所有尚未结束的等待
     *
     * @param exitCode 子进程退出码
     */
    private void handleProcessExit(int exitCode) {
        if (!processExitCode.complete(exitCode)) {
            return;
        }
        PromptTracker tracker = activePrompt.get();
        if (tracker != null) {
            tracker.markProcessExited(exitCode);
        }
        RpcProcessExitedException exception = new RpcProcessExitedException(exitCode);
        for (CompletableFuture<JsonNode> responseFuture : pendingResponses.values()) {
            responseFuture.completeExceptionally(exception);
        }
        pendingResponses.clear();
    }

    /**
     * 处理协议或管道故障并终止不再可信的子进程
     *
     * @param failure I/O 或协议故障
     */
    private void handleTransportFailure(IOException failure) {
        for (CompletableFuture<JsonNode> responseFuture : pendingResponses.values()) {
            responseFuture.completeExceptionally(failure);
        }
        pendingResponses.clear();
        Process currentProcess = process;
        if (currentProcess != null && currentProcess.isAlive()) {
            currentProcess.destroy();
        }
    }

    /**
     * 在正常等待后升级终止仍未退出的子进程
     *
     * @param currentProcess 当前子进程
     * @throws IOException 等待退出失败
     */
    private void stopProcess(Process currentProcess) throws IOException {
        try {
            if (!currentProcess.waitFor(CLOSE_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS)) {
                currentProcess.destroy();
                if (!currentProcess.waitFor(CLOSE_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS)) {
                    currentProcess.destroyForcibly();
                    currentProcess.waitFor(CLOSE_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
                }
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            currentProcess.destroyForcibly();
            throw new IOException("Interrupted while waiting for RPC process exit", exception);
        }
    }

    /**
     * 校验客户端已启动且仍可写入
     *
     * @throws IOException 子进程不可用
     */
    private void ensureRunning() throws IOException {
        if (!started.get()) {
            throw new IllegalStateException("RPC client has not been started");
        }
        Process currentProcess = process;
        if (closed.get() || currentProcess == null || !currentProcess.isAlive()) {
            throw new RpcProcessExitedException(processExitCode.getNow(-1));
        }
    }

    /**
     * 校验等待上限为正数
     *
     * @param timeout 等待上限
     */
    private static void validateTimeout(Duration timeout) {
        Objects.requireNonNull(timeout, "timeout");
        if (timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
    }

    /**
     * 在统一截止时间内等待 Future，并收敛异常类型
     *
     * @param future 待完成 Future
     * @param deadlineNanos 截止时间
     * @param <T> 结果类型
     * @return Future 结果
     * @throws IOException 异步 I/O 或协议失败
     * @throws InterruptedException 当前线程被中断
     * @throws TimeoutException 等待超时
     */
    private static <T> T await(CompletableFuture<T> future, long deadlineNanos)
            throws IOException, InterruptedException, TimeoutException {
        long remainingNanos = deadlineNanos - System.nanoTime();
        if (remainingNanos <= 0) {
            throw new TimeoutException("RPC operation timed out");
        }
        try {
            return future.get(remainingNanos, TimeUnit.NANOSECONDS);
        } catch (ExecutionException exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof IOException) {
                throw (IOException) cause;
            }
            throw new IOException("RPC operation failed", cause);
        }
    }

    /**
     * Prompt 异步事件状态机
     *
     * 职责：在 Response 接收后等待最终 Assistant Message 与 agent_settled
     *
     * @author xiexu
     */
    private static final class PromptTracker {

        private final CompletableFuture<PromptRunResult> completion = new CompletableFuture<PromptRunResult>();
        private boolean accepted;
        private boolean settled;
        private String finalText = "";
        private String stopReason;
        private String errorMessage;

        /**
         * 返回 Prompt 完成 Future
         *
         * @return Prompt 完成 Future
         */
        private CompletableFuture<PromptRunResult> getCompletion() {
            return completion;
        }

        /**
         * 返回已完成结果，尚未完成时返回 null
         *
         * @return 已完成结果或 null
         */
        private PromptRunResult getCompletedResult() {
            return completion.getNow(null);
        }

        /**
         * 标记 Prompt 已被 RPC 接收
         */
        private synchronized void markAccepted() {
            accepted = true;
            tryComplete();
        }

        /**
         * 标记 Prompt 在接收前被拒绝
         *
         * @param error 拒绝原因
         */
        private void markRejected(String error) {
            completion.complete(PromptRunResult.rejected(error));
        }

        /**
         * 标记子进程在 Run 收尾前退出
         *
         * @param exitCode 子进程退出码
         */
        private synchronized void markProcessExited(int exitCode) {
            completion.complete(PromptRunResult.processExited(accepted, exitCode));
        }

        /**
         * 消费异步 Agent Event
         *
         * @param event Event JSON
         */
        private synchronized void onEvent(JsonNode event) {
            String eventType = event.path("type").asText("");
            if ("message_end".equals(eventType)) {
                captureAssistantMessage(event.path("message"));
            } else if ("agent_settled".equals(eventType)) {
                settled = true;
                tryComplete();
            }
        }

        /**
         * 保存最终 Assistant Message 的权威字段
         *
         * @param message Message JSON
         */
        private void captureAssistantMessage(JsonNode message) {
            if (!"assistant".equals(message.path("role").asText(""))) {
                return;
            }
            stopReason = message.path("stopReason").asText(null);
            errorMessage = message.path("errorMessage").asText(null);
            finalText = extractText(message.path("content"));
        }

        /**
         * 在 Response 已接收且 Agent 已 settled 时完成结果
         */
        private void tryComplete() {
            if (!accepted || !settled || completion.isDone()) {
                return;
            }
            if (stopReason == null) {
                completion.complete(PromptRunResult.runtimeFailure("", "Agent settled without an Assistant message"));
                return;
            }
            if ("error".equals(stopReason) || "aborted".equals(stopReason)) {
                String failure = errorMessage == null ? "Assistant stopped with reason: " + stopReason : errorMessage;
                completion.complete(PromptRunResult.runtimeFailure(finalText, failure));
                return;
            }
            completion.complete(PromptRunResult.success(finalText));
        }

        /**
         * 提取 Assistant Message 中的全部文字块
         *
         * @param content Message content 数组
         * @return 合并后的文字
         */
        private static String extractText(JsonNode content) {
            if (!(content instanceof ArrayNode)) {
                return "";
            }
            StringBuilder text = new StringBuilder();
            for (JsonNode part : content) {
                if ("text".equals(part.path("type").asText(""))) {
                    text.append(part.path("text").asText(""));
                }
            }
            return text.toString();
        }
    }

    /**
     * RPC I/O 线程工厂
     *
     * 职责：创建有界命名的后台线程
     *
     * @author xiexu
     */
    private static final class RpcThreadFactory implements ThreadFactory {

        /**
         * 创建一个 RPC 后台线程
         *
         * @param runnable 线程任务
         * @return 后台线程
         */
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "pi-rpc-client-" + THREAD_SEQUENCE.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        }
    }
}
