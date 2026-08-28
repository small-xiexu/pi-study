package com.xiexu.pistudy.rpc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pi RPC 客户端确定性测试
 *
 * 职责：通过真实 Fake 子进程验证关联、成功、失败和退出合同
 *
 * @author xiexu
 */
class PiRpcClientTest {

    private static final Duration RUN_TIMEOUT = Duration.ofSeconds(10);
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 验证逆序 Response 仍按请求 ID 完成正确 Future
     *
     * @throws Exception 子进程或协议失败
     */
    @Test
    void shouldCorrelateOutOfOrderResponsesByRequestId() throws Exception {
        PiRpcClient client = startFakeClient();
        try {
            ObjectNode firstCommand = objectMapper.createObjectNode();
            firstCommand.put("type", "get_state");
            ObjectNode secondCommand = objectMapper.createObjectNode();
            secondCommand.put("type", "get_state");

            CompletableFuture<JsonNode> first = client.sendCommand(firstCommand);
            CompletableFuture<JsonNode> second = client.sendCommand(secondCommand);

            assertEquals(1, first.get(5, TimeUnit.SECONDS).path("data").path("sequence").asInt());
            assertEquals(2, second.get(5, TimeUnit.SECONDS).path("data").path("sequence").asInt());
        } finally {
            client.close();
        }
        assertEquals(0, client.awaitExit(Duration.ofSeconds(5)));
    }

    /**
     * 验证正常 Prompt 在 accepted 与 settled 后返回最终文字
     *
     * @throws Exception 子进程或协议失败
     */
    @Test
    void shouldReturnSuccessfulPromptAfterAgentSettled() throws Exception {
        PiRpcClient client = startFakeClient();
        PromptRunResult result;
        try {
            result = client.runPrompt("SUCCESS", RUN_TIMEOUT);
        } finally {
            client.close();
        }

        assertEquals(PromptRunStatus.SUCCESS, result.getStatus());
        assertTrue(result.isResponseAccepted());
        assertTrue(result.isSettled());
        assertEquals("RPC_FAKE_OK", result.getFinalText());
        assertEquals(0, client.awaitExit(Duration.ofSeconds(5)));
    }

    /**
     * 验证 success=false 被识别为接收前拒绝
     *
     * @throws Exception 子进程或协议失败
     */
    @Test
    void shouldSeparatePreAcceptanceRejection() throws Exception {
        PiRpcClient client = startFakeClient();
        PromptRunResult result;
        try {
            result = client.runPrompt("REJECT", RUN_TIMEOUT);
        } finally {
            client.close();
        }

        assertEquals(PromptRunStatus.REJECTED, result.getStatus());
        assertFalse(result.isResponseAccepted());
        assertFalse(result.isSettled());
        assertEquals("PROMPT_REJECTED", result.getError());
    }

    /**
     * 验证 accepted 后 Assistant error 被识别为运行期失败
     *
     * @throws Exception 子进程或协议失败
     */
    @Test
    void shouldSeparateRuntimeFailureAfterAcceptance() throws Exception {
        PiRpcClient client = startFakeClient();
        PromptRunResult result;
        try {
            result = client.runPrompt("RUNTIME_FAILURE", RUN_TIMEOUT);
        } finally {
            client.close();
        }

        assertEquals(PromptRunStatus.RUNTIME_FAILURE, result.getStatus());
        assertTrue(result.isResponseAccepted());
        assertTrue(result.isSettled());
        assertEquals("MODEL_RUNTIME_FAILURE", result.getError());
    }

    /**
     * 验证 Response 前退出被识别为独立进程失败
     *
     * @throws Exception 子进程或协议失败
     */
    @Test
    void shouldReportProcessExitBeforeResponse() throws Exception {
        PiRpcClient client = startFakeClient();
        PromptRunResult result;
        try {
            result = client.runPrompt("EXIT_EARLY", RUN_TIMEOUT);
        } finally {
            client.close();
        }

        assertEquals(PromptRunStatus.PROCESS_EXITED, result.getStatus());
        assertFalse(result.isResponseAccepted());
        assertEquals(Integer.valueOf(7), result.getExitCode());
        assertEquals(7, client.awaitExit(Duration.ofSeconds(5)));
    }

    /**
     * 启动一个新的 Fake Java RPC 子进程
     *
     * @return 已启动客户端
     * @throws Exception 子进程启动失败
     */
    private PiRpcClient startFakeClient() throws Exception {
        String javaHome = System.getProperty("java.home");
        Path javaExecutable = Paths.get(javaHome, "bin", "java");
        String classPath = System.getProperty("java.class.path");
        List<String> command = new ArrayList<String>();
        command.add(javaExecutable.toString());
        command.add("-cp");
        command.add(classPath);
        command.add(FakeRpcServerMain.class.getName());
        PiRpcClient client = new PiRpcClient(command, new File(System.getProperty("user.dir")));
        client.start();
        return client;
    }
}
