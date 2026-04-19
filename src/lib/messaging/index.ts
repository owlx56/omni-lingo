// 类型安全的消息通道：业务代码只和 ProtocolMap 打交道，
// 不直接碰 browser.runtime.sendMessage。

import type {
  TranslateRequest,
  TranslateResponse,
} from "@/engines/types";

export interface ProtocolMap {
  ping: { input: { text: string }; output: { echo: string; at: number } };
  translate: {
    input: TranslateRequest & { engine?: string };
    output: TranslateResponse;
  };
}

type Envelope<K extends keyof ProtocolMap = keyof ProtocolMap> = {
  __onelingo: true;
  type: K;
  input: ProtocolMap[K]["input"];
};

type Handler<K extends keyof ProtocolMap> = (
  input: ProtocolMap[K]["input"],
) => ProtocolMap[K]["output"] | Promise<ProtocolMap[K]["output"]>;

function isEnvelope(raw: unknown): raw is Envelope {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { __onelingo?: unknown }).__onelingo === true
  );
}

export function sendMessage<K extends keyof ProtocolMap>(
  type: K,
  input: ProtocolMap[K]["input"],
): Promise<ProtocolMap[K]["output"]> {
  const env: Envelope<K> = { __onelingo: true, type, input };
  return browser.runtime.sendMessage(env) as Promise<ProtocolMap[K]["output"]>;
}

export function onMessage<K extends keyof ProtocolMap>(
  type: K,
  handler: Handler<K>,
): () => void {
  const listener = (raw: unknown): Promise<unknown> | undefined => {
    if (!isEnvelope(raw) || raw.type !== type) return undefined;
    return Promise.resolve(handler(raw.input as ProtocolMap[K]["input"]));
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
