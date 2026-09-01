import { rm } from "node:fs/promises";

// dist 是 tsconfig.json 指定的可再生编译输出；每次构建前清理可避免旧模块进入发布包。
await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
