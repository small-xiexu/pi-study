package com.xiexu.pistudy.rpc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.BufferedWriter;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Fake Pi RPC 子进程
 *
 * 职责：为 Java 客户端测试提供确定性的成功、失败、逆序 Response 和退出行为
 *
 * @author xiexu
 */
public final class FakeRpcServerMain {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    /**
     * 阻止创建 Fake 子进程实例
     */
    private FakeRpcServerMain() {
    }

    /**
     * 启动 Fake RPC 读取循环
     *
     * @param args 未使用的命令行参数
     * @throws Exception 协议夹具失败
     */
    public static void main(String[] args) throws Exception {
        FileInputStream input = new FileInputStream(FileDescriptor.in);
        FileOutputStream output = new FileOutputStream(FileDescriptor.out);
        BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8));
        List<JsonNode> delayedStateCommands = new ArrayList<JsonNode>();
        StrictJsonlReader.read(input, line -> handleLine(line, writer, delayedStateCommands));
        writer.flush();
    }

    /**
     * 解析一条 Command 并输出确定性协议记录
     *
     * @param line Command JSONL 记录
     * @param writer stdout writer
     * @param delayedStateCommands 等待逆序回复的状态命令
     */
    private static void handleLine(String line,
                                   BufferedWriter writer,
                                   List<JsonNode> delayedStateCommands) {
        try {
            JsonNode command = OBJECT_MAPPER.readTree(line);
            String type = command.path("type").asText("");
            if ("get_state".equals(type)) {
                handleState(command, writer, delayedStateCommands);
            } else if ("prompt".equals(type)) {
                handlePrompt(command, writer);
            } else {
                writeResponse(writer, command.path("id").asText(), type, false, "Unsupported fixture command", null);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Fake RPC fixture failed", exception);
        }
    }

    /**
     * 收集两个状态命令并按相反顺序响应
     *
     * @param command 状态命令
     * @param writer stdout writer
     * @param delayedStateCommands 等待命令
     * @throws IOException 输出失败
     */
    private static void handleState(JsonNode command,
                                    BufferedWriter writer,
                                    List<JsonNode> delayedStateCommands) throws IOException {
        delayedStateCommands.add(command);
        if (delayedStateCommands.size() != 2) {
            return;
        }
        JsonNode second = delayedStateCommands.get(1);
        JsonNode first = delayedStateCommands.get(0);
        writeStateResponse(writer, second, 2);
        writeStateResponse(writer, first, 1);
        delayedStateCommands.clear();
    }

    /**
     * 根据 Prompt marker 输出对应场景
     *
     * @param command Prompt Command
     * @param writer stdout writer
     * @throws IOException 输出失败
     */
    private static void handlePrompt(JsonNode command, BufferedWriter writer) throws IOException {
        String id = command.path("id").asText();
        String message = command.path("message").asText();
        if ("REJECT".equals(message)) {
            writeResponse(writer, id, "prompt", false, "PROMPT_REJECTED", null);
            return;
        }
        if ("EXIT_EARLY".equals(message)) {
            writer.flush();
            System.exit(7);
            return;
        }
        writeResponse(writer, id, "prompt", true, null, null);
        writeEvent(writer, event("agent_start"));
        if ("RUNTIME_FAILURE".equals(message)) {
            writeEvent(writer, assistantMessageEnd("", "error", "MODEL_RUNTIME_FAILURE"));
        } else {
            writeEvent(writer, assistantMessageEnd("RPC_FAKE_OK", "stop", null));
        }
        writeEvent(writer, event("agent_settled"));
    }

    /**
     * 输出带序号的状态 Response
     *
     * @param writer stdout writer
     * @param command 原始 Command
     * @param sequence 场景序号
     * @throws IOException 输出失败
     */
    private static void writeStateResponse(BufferedWriter writer, JsonNode command, int sequence) throws IOException {
        ObjectNode data = OBJECT_MAPPER.createObjectNode();
        data.put("sequence", sequence);
        writeResponse(writer, command.path("id").asText(), "get_state", true, null, data);
    }

    /**
     * 创建简单 Event
     *
     * @param type Event 类型
     * @return Event JSON
     */
    private static ObjectNode event(String type) {
        ObjectNode event = OBJECT_MAPPER.createObjectNode();
        event.put("type", type);
        return event;
    }

    /**
     * 创建最终 Assistant message_end Event
     *
     * @param text 最终文字
     * @param stopReason 停止原因
     * @param errorMessage 错误信息
     * @return message_end Event
     */
    private static ObjectNode assistantMessageEnd(String text, String stopReason, String errorMessage) {
        ObjectNode event = event("message_end");
        ObjectNode message = event.putObject("message");
        message.put("role", "assistant");
        message.put("stopReason", stopReason);
        if (errorMessage != null) {
            message.put("errorMessage", errorMessage);
        }
        ArrayNode content = message.putArray("content");
        if (!text.isEmpty()) {
            ObjectNode textPart = content.addObject();
            textPart.put("type", "text");
            textPart.put("text", text);
        }
        return event;
    }

    /**
     * 输出 Command Response
     *
     * @param writer stdout writer
     * @param id 请求 ID
     * @param command Command 类型
     * @param success 是否接收成功
     * @param error 错误信息
     * @param data Response data
     * @throws IOException 输出失败
     */
    private static void writeResponse(BufferedWriter writer,
                                      String id,
                                      String command,
                                      boolean success,
                                      String error,
                                      JsonNode data) throws IOException {
        ObjectNode response = OBJECT_MAPPER.createObjectNode();
        response.put("id", id);
        response.put("type", "response");
        response.put("command", command);
        response.put("success", success);
        if (error != null) {
            response.put("error", error);
        }
        if (data != null) {
            response.set("data", data);
        }
        writeEvent(writer, response);
    }

    /**
     * 输出并 flush 一条 JSONL 记录
     *
     * @param writer stdout writer
     * @param event JSON 记录
     * @throws IOException 输出失败
     */
    private static void writeEvent(BufferedWriter writer, JsonNode event) throws IOException {
        writer.write(OBJECT_MAPPER.writeValueAsString(event));
        writer.write('\n');
        writer.flush();
    }
}
