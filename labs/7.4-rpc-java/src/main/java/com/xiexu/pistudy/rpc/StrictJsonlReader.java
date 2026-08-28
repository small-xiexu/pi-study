package com.xiexu.pistudy.rpc;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.function.Consumer;

/**
 * 严格 LF JSONL 读取器
 *
 * 职责：只以 LF 分隔记录，保留 JSON 字符串中的 Unicode 行分隔符
 *
 * @author xiexu
 */
public final class StrictJsonlReader {

    private static final int BUFFER_SIZE = 4096;
    private static final int MAX_RECORD_CHARS = 4 * 1024 * 1024;

    /**
     * 阻止创建工具类实例
     */
    private StrictJsonlReader() {
    }

    /**
     * 持续读取严格 LF JSONL 记录直到输入结束
     *
     * @param input UTF-8 输入流
     * @param recordConsumer 单条记录处理器
     * @throws IOException 输入或 framing 异常
     */
    public static void read(InputStream input, Consumer<String> recordConsumer) throws IOException {
        Objects.requireNonNull(input, "input");
        Objects.requireNonNull(recordConsumer, "recordConsumer");
        Reader reader = new InputStreamReader(input, StandardCharsets.UTF_8);
        char[] chunk = new char[BUFFER_SIZE];
        StringBuilder record = new StringBuilder();
        int length;
        while ((length = reader.read(chunk)) != -1) {
            appendChunk(chunk, length, record, recordConsumer);
        }
        if (record.length() > 0) {
            emit(record, recordConsumer);
        }
    }

    /**
     * 追加字符块并按 LF 发出完整记录
     *
     * @param chunk 字符块
     * @param length 有效字符数
     * @param record 当前记录缓冲区
     * @param recordConsumer 单条记录处理器
     * @throws IOException 单条记录超过安全上限
     */
    private static void appendChunk(char[] chunk,
                                    int length,
                                    StringBuilder record,
                                    Consumer<String> recordConsumer) throws IOException {
        for (int index = 0; index < length; index++) {
            char current = chunk[index];
            if (current == '\n') {
                emit(record, recordConsumer);
            } else {
                record.append(current);
                if (record.length() > MAX_RECORD_CHARS) {
                    throw new RpcProtocolException("RPC JSONL record exceeds the client limit");
                }
            }
        }
    }

    /**
     * 发出一条记录并兼容去除 LF 前的单个 CR
     *
     * @param record 当前记录缓冲区
     * @param recordConsumer 单条记录处理器
     */
    private static void emit(StringBuilder record, Consumer<String> recordConsumer) {
        int end = record.length();
        if (end > 0 && record.charAt(end - 1) == '\r') {
            end--;
        }
        String line = record.substring(0, end);
        record.setLength(0);
        recordConsumer.accept(line);
    }
}
