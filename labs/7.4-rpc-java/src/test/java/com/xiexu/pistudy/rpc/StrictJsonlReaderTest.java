package com.xiexu.pistudy.rpc;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 严格 JSONL 读取器测试
 *
 * 职责：验证 LF framing、CRLF 兼容和 Unicode 分隔符保留
 *
 * @author xiexu
 */
class StrictJsonlReaderTest {

    /**
     * 验证只按 LF 分隔并保留 JSON 字符串内 Unicode 分隔符
     *
     * @throws Exception 读取失败
     */
    @Test
    void shouldSplitOnlyOnLfAndStripOneTrailingCr() throws Exception {
        String input = "{\"value\":\"a\u2028b\"}\n{\"value\":2}\r\n{\"value\":3}";
        ByteArrayInputStream stream = new ByteArrayInputStream(input.getBytes(StandardCharsets.UTF_8));
        List<String> records = new ArrayList<String>();

        StrictJsonlReader.read(stream, records::add);

        assertEquals(3, records.size());
        assertEquals("{\"value\":\"a\u2028b\"}", records.get(0));
        assertEquals("{\"value\":2}", records.get(1));
        assertEquals("{\"value\":3}", records.get(2));
    }
}
