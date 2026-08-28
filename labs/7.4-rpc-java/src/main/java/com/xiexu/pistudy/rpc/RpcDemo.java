package com.xiexu.pistudy.rpc;

import lombok.extern.slf4j.Slf4j;

import java.io.File;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Java RPC 真实 Model 演示入口
 *
 * 职责：启动真实 Pi RPC 子进程并输出不含正文的有界验收结果
 *
 * @author xiexu
 */
@Slf4j
public final class RpcDemo {

    private static final String DEFAULT_PROVIDER = "openai";
    private static final String DEFAULT_MODEL = "gpt-5.6-sol";
    private static final String REAL_MARKER = "RPC_JAVA_REAL_OK";

    /**
     * 阻止创建演示入口实例
     */
    private RpcDemo() {
    }

    /**
     * 运行一次真实 Pi RPC smoke
     *
     * @param args 未使用的命令行参数
     */
    public static void main(String[] args) {
        try {
            boolean passed = runRealSmoke();
            if (!passed) {
                System.exit(2);
            }
        } catch (Exception exception) {
            String errorType = exception.getClass().getSimpleName();
            log.error("RPC_REAL_RESULT passed: false, errorType: {}", errorType);
            System.exit(1);
        }
    }

    /**
     * 启动真实子进程并验证一次无 Tool Prompt
     *
     * @return 真实 smoke 是否通过
     * @throws Exception 子进程、协议或等待失败
     */
    private static boolean runRealSmoke() throws Exception {
        List<String> command = buildPiCommand();
        File workingDirectory = new File(System.getProperty("user.dir"));
        PiRpcClient client = new PiRpcClient(command, workingDirectory);
        AtomicInteger eventCount = new AtomicInteger();
        client.addEventListener(event -> eventCount.incrementAndGet());
        PromptRunResult result;
        int exitCode;
        try {
            client.start();
            String prompt = "Reply exactly " + REAL_MARKER + ". Do not call tools.";
            result = client.runPrompt(prompt, Duration.ofSeconds(90));
        } finally {
            client.close();
        }
        try {
            exitCode = client.awaitExit(Duration.ofSeconds(5));
        } catch (TimeoutException exception) {
            exitCode = -1;
        }
        boolean markerSeen = result.getFinalText().contains(REAL_MARKER);
        boolean passed = result.getStatus() == PromptRunStatus.SUCCESS
                && result.isResponseAccepted()
                && result.isSettled()
                && markerSeen
                && exitCode == 0;
        log.info("RPC_REAL_RESULT status: {}, accepted: {}, settled: {}, markerSeen: {}, eventCount: {}, exitCode: {}, passed: {}",
                result.getStatus(),
                result.isResponseAccepted(),
                result.isSettled(),
                markerSeen,
                eventCount.get(),
                exitCode,
                passed);
        return passed;
    }

    /**
     * 组装不包含凭据的 Pi RPC 启动参数
     *
     * @return Pi RPC 子进程命令
     */
    private static List<String> buildPiCommand() {
        String piCommand = System.getProperty("pi.command", "pi");
        String provider = System.getProperty("pi.provider", DEFAULT_PROVIDER);
        String model = System.getProperty("pi.model", DEFAULT_MODEL);
        List<String> command = new ArrayList<String>();
        command.add(piCommand);
        command.add("--mode");
        command.add("rpc");
        command.add("--no-session");
        command.add("--no-approve");
        command.add("--provider");
        command.add(provider);
        command.add("--model");
        command.add(model);
        return command;
    }
}
