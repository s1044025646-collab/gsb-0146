# hexcheck — 换热器性能校核与工况比较后端

面向**稳态、无外界热损失、定比热**的单程式**并流 / 逆流**间壁换热器，提供：

- 效能–NTU（ε-NTU）法求热负荷与两侧出口温度
- 端温差对数平均温差（LMTD）独立交叉校核
- 热容量率 Cmin/Cmax、最小热容量侧、污垢对有效 U 的影响
- 工况版本管理（输入不可变，修订产生新版本）、能量账、幂等提交
- 仅 HTTP API（`node:http`）+ CLI；**无网页、无相变仿真、不控制真实设备**

## 模型与数值稳定性

- 容量率：`Ch = mh·cph`，`Cc = mc·cpc`，`Cr = Cmin/Cmax`
- 污垢：`1/Ueff = 1/Uclean + Rf,hot + Rf,cold`，`NTU = Ueff·A/Cmin`
- 并流：`ε = (1 - e^{-NTU(1+Cr)}) / (1+Cr)`
- 逆流：`ε = (1 - e^{-NTU(1-Cr)}) / (1 - Cr·e^{-NTU(1-Cr)})`
- 稳定极限（无 0/0）：
  - `Cr = 1`：并流 `ε=(1-e^{-2NTU})/2`，逆流 `ε=NTU/(1+NTU)`
  - 两端温差相等：LMTD 取算术相等值；两端均为 0：LMTD=0
  - `NTU → 0`：ε→0、Q→0，使用一阶展开
- LMTD 端差按**同一物理端**配对（并流：入口对入口、出口对出口；逆流：热入–冷出、热出–冷入），`Q_LMTD = Ueff·A·LMTD`（F=1）
- 出口温度交叉：
  - 逆流允许 `Th,out < Tc,out`（两股流体该端并不相遇），只要两个端差非负即有效
  - 并流该交叉属于局部热流方向违规，判为 infeasible
  - 测量校核时，逆流的合法交叉与真正违反局部热流方向（如冷出口高于热入口）分开报告
- 拒绝条件（明确错误码）：`ZERO_FLOW`、`NON_POSITIVE_CP`、`INVALID_TEMPERATURE_SPREAD`、
  `NON_POSITIVE_U`、`NEGATIVE_AREA`、`NEGATIVE_FOULING`；不支持相变（定 cp 模型）
- 测量不平衡：**原样保留测量值**，报告 `Qhot/Qcold` 与不平衡度，不自动改成守恒

## 依赖

- Node.js ≥ 22.5（使用内置实验模块 `node:sqlite`，无需原生编译）
- TypeScript、tsx、@types/node（仅开发依赖）

```powershell
npm install
```

## 测试

```powershell
npm test          # 38 项：手算算例、守恒、ε 上下界、面积单调性、
                  # 温标平移不变、版本复现、事务回滚、幂等、分页、
                  # 重启持久化、HTTP 失败路径
npm run demo      # 可重复端到端演示（固定时钟、每次重建 data/demo.sqlite）
npm run build     # 仅类型检查/编译（tsconfig strict）
```

测试临时目录固定在项目内 `./.tmp-test`。

## 启动 / 停止 API

```powershell
npm start                 # 仅绑定 127.0.0.1，端口自动分配(0)
# 输出: http://127.0.0.1:<port>；端口写入 data/server.port，PID 写入 data/server.pid
npm run clean             # 停止该 PID（仅本项目记录的进程）并删除 ./data、./.tmp-test
```

可选环境变量：`HEXCHECK_HOST`（默认 127.0.0.1）、`HEXCHECK_PORT`（默认 0=自动）、
`HEXCHECK_DB`（默认 `./data/hexcheck.sqlite`）。所有数据文件都在项目目录内。

### API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查与模型适用范围 |
| GET | `/units` | 默认单位集 |
| POST | `/cases` | 建工况（头 `Idempotency-Key` 可重复提交） |
| GET | `/cases?limit=&offset=&search=` | 分页查询 |
| GET | `/cases/:id?version=` | 工况（最新或指定版本）+ 求解 |
| GET | `/cases/:id/versions` | 版本分页 |
| POST | `/cases/:id/revisions` | 修订（新递增版本；`baseVersion` 乐观并发） |
| GET | `/cases/:id/solution?version=` | ε-NTU 解 + LMTD 校核 |
| POST | `/cases/:id/check` | 核对测得出口（保留原值，报告不平衡/违规/交叉） |
| GET | `/cases/:id/scan?param=mc|mh|area&from=&to=&count=` | 流量/面积扫描 |
| GET | `/cases/:id/compare?version=` | 并流 vs 逆流对比 |
| GET | `/cases/:id/ledger` | 能量账分页 |

错误响应统一为 `{ "error": { "code", "message", "details?" } }`，
`code` 为上述稳定错误码；404=未找到，409=版本/幂等冲突。

输入单位由 `units` 对象声明（温度 C/K/F，流量 kg/s、kg/h、t/h、lb/h，
cp J/kg.K、kJ/kg.K、Btu/lb.F，U 与污垢因子多种制，面积 m2/ft2），内部统一转 SI；
温度仅以开尔文温差参与计算，故温标平移不影响任何结果。

### 快速调用

```powershell
$port = Get-Content data/server.port
$body = @{
  name="cr1"; arrangement="counter"; thIn=120; tcIn=40
  mh=2; mc=2; cph=1000; cpc=1000; uClean=400; area=5
} | ConvertTo-Json
Invoke-RestMethod "http://127.0.0.1:$port/cases" -Method Post -Body $body -ContentType application/json
Invoke-RestMethod "http://127.0.0.1:$port/cases/1/compare"
```

## CLI

CLI 使用 SI 单位（`--help` 见无参数运行）。会打印操作前后状态：

```powershell
npx tsx src/cli/cli.ts create --name cr1 --arrangement counter `
  --thIn 120 --tcIn 40 --mh 2 --mc 2 --cph 1000 --cpc 1000 --u 400 --area 5
npx tsx src/cli/cli.ts revise 1 --baseVersion 1 --area 8 --arrangement counter `
  --thIn 120 --tcIn 40 --mh 2 --mc 2 --cph 1000 --cpc 1000 --u 400 --rfHot 0.001
npx tsx src/cli/cli.ts list
npx tsx src/cli/cli.ts versions 1
npx tsx src/cli/cli.ts solve 1 --version 1
npx tsx src/cli/cli.ts check 1 --thOut 80 --tcOut 81.5 --version 1
npx tsx src/cli/cli.ts scan 1 --param area --from 0 --to 20 --count 5
npx tsx src/cli/cli.ts compare 1
npx tsx src/cli/cli.ts ledger 1
npx tsx src/cli/cli.ts scope
```

## 虚构手算算例（测试夹具）

- 等热容量逆流：Cr=1、NTU=1 → ε=0.5、Q=80 kW、两出口均 80 °C、
  两端温差均 40 K、LMTD=40 K、Q_LMTD=80 kW（精确闭合）
- 等热容量并流：ε=(1-e⁻²)/2≈0.43233
- Cr=0.5、NTU=1 逆流闭式解
- 极大 NTU（ε→1，出口有界）与 NTU=0（无传热）
- 污垢增大：Ueff、NTU、ε、Q 严格下降
- 逆流合法出口交叉；并流交叉判违规
- 混合单位（°F、kg/h、kJ/kg.K、kcal/m².h.°C）与 SI 结果一致

## 数据库与迁移

SQLite 表：`cases`、`case_versions`（`(case_id, version)` 唯一）、
`energy_ledger`、`idempotency_keys`、`schema_meta`。
迁移脚本全部 `IF NOT EXISTS / OR IGNORE`，可在已有库上重复执行。
建工况与写能量账在同一事务内，验证失败时整体回滚。

## 项目边界

仅教学/工程估算用途；不适用于相变、变比热、多程/叉流结构修正、
非稳态、对外散热或真实设备控制。
