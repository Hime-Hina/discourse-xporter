# Discourse Xporter 项目指引

本项目是用 TypeScript、Vite 和 vite-plugin-monkey 构建的 Discourse userscript。

- 开发前阅读[项目规范](docs/spec/frontend/index.md)，按改动涉及的模块查阅对应章节。
- 跨模块改动或复用现有实现时，参阅[思考指南](docs/spec/guides/index.md)。

提交前运行：

    pnpm exec tsc --noEmit
    pnpm run lint
    pnpm test:run
    pnpm run build
