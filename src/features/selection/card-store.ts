// 划词卡片的共享响应式状态。
// vanilla 编排器写入，Solid 组件读取，双向解耦。

import { createSignal } from "solid-js";

export type SelEngine = "google" | "deepl";
export const SEL_ENGINES: SelEngine[] = ["google", "deepl"];

// 当前划词文本（引擎切换时复用）
export const [selText, setSelText] = createSignal("");
// 翻译目标语言
export const [selTarget, setSelTarget] = createSignal("zh");
// null = 还在路上；string = 已到
export const [selResult, setSelResult] = createSignal<string | null>(null);
// 当前生效引擎
export const [selEngine, setSelEngine] = createSignal<SelEngine>("google");
