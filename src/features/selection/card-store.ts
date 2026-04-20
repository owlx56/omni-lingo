// 划词卡片的共享响应式状态。
// vanilla 编排器写入，Solid 组件读取，双向解耦。

import { createSignal } from "solid-js";

// 当前划词文本
export const [selText, setSelText] = createSignal("");
// 翻译目标语言
export const [selTarget, setSelTarget] = createSignal("zh");
// null = 还在路上；string = 已到
export const [selResult, setSelResult] = createSignal<string | null>(null);
