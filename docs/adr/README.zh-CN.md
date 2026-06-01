# 架构决策记录

[English](README.md) | 简体中文

本目录记录修改 Legax 架构前应理解的持久技术决策。ADR 不是安装指南；它解释项目为何具有当前形状，以及改变它需要重新评估什么。

## 记录

| ADR | 决策 |
| --- | --- |
| [0001 核心架构约束](0001-core-architecture-constraints.zh-CN.md) | 无依赖 Node runtime、YAML-only config、三平面架构、relay-owned transport ingress、runtime-state 与 relay-store 分离，以及 permission-boundary 规则。 |

## 编写新 ADR

- 使用短编号文件名：`NNNN-short-topic.md`。
- 同一改动加入简体中文配对文件。
- 写明 status、context、decision、consequence，以及什么情况会重新打开决策。
- 链接相关代码和文档，不重复完整实现细节。
