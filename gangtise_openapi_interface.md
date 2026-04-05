# Gangtise OpenAPI 接口完整说明

本文档基于仓库中的Gangtise OpenAPI官方文档页面整理，覆盖：

- 认证方式
- 统一返回结构
- 错误码说明
- 查询参数枚举/机构列表
- Insight 类接口
- Quote 类接口
- AI 类接口

> 说明：本文档聚焦实际接口调用说明（URL、方法、参数、返回字段）。部分官方页面中的超长“返回示例 JSON”未整段原样复制，但会完整保留字段表与关键示例信息。

---

## 1. 认证

### 1.1 获取 Token

- **请求 URL**：`https://open.gangtise.com/application/auth/oauth/open/loginV2`
- **请求方式**：`POST`

#### 请求参数

| 参数名 | 必选 | 类型 | 说明 |
|---|---|---|---|
| accessKey | 是 | String | 开发账号 AK |
| secretKey | 是 | String | 开发账号 SK |

#### 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| accessToken | String | 开发账号 token，V2 接口已自带 `Bearer ` 前缀 |
| expiresIn | Long | 有效时间（秒） |
| uid | Integer | 开发账号 UID |
| userName | String | 开发账号名称 |
| tenantId | Integer | 所属租户 ID |
| time | Integer | 登录时间（秒级时间戳） |

#### 请求示例

```json
{
  "accessKey": "your accessKey",
  "secretKey": "your secretKey"
}
```

---

### 1.2 统一返回说明

官方统一 envelope：

```json
{
  "code": "000000",
  "msg": "请求成功",
  "status": true,
  "data": {}
}
```

#### 返回字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| code | String | 返回错误编码，`000000` 表示成功，其余为异常 |
| msg | String | 提示信息 |
| status | Boolean | `true` 成功，`false` 失败 |
| data | Object | 实际返回数据 |

---

### 1.3 常见错误码

| 错误码 | 含义 |
|---|---|
| 999999 | 系统错误 |
| 999997 | 未开通接口权限 |
| 999995 | 积分不足 |
| 900002 | uid 为空 |
| 900001 | 请求参数为空 |
| 8000014 | 开发账号 AK 错误 |
| 8000015 | 开发账号 SK 错误 |
| 8000016 | 开发账号状态异常 |
| 8000018 | 开发账号已到期 |
| 903301 | 今日调用次数已达到上限 |
| 433007 | 不支持该数据源 |
| 410004 | 数据未找到 |
| 10011401 | 数据受白名单权限控制 |

---

## 2. 查询参数/枚举接口

### 查询研究方向分类

| 研究方向代码 | 研究方向名称 |
|---|---|
| 122000001 | 宏观 |
| 122000002 | 策略 |
| 122000003 | 固收 |
| 122000004 | 金工 |
| 122000005 | 海外 |
| 100800122 | 中信非银 |
| 100800115 | 中信消服 |
| 100800111 | 中信电新 |
| 100800104 | 中信电公 |
| 100800101 | 中信石油石化 |
| 100800130 | 中信综合 |
| 100800129 | 中信传媒 |
| 100800128 | 中信计算机 |
| 100800127 | 中信通信 |
| 100800126 | 中信电子 |
| 100800125 | 中信交通运输 |
| 100800124 | 中信综合金融 |
| 100800123 | 中信房地产 |
| 100800121 | 中信银行 |
| 100800120 | 中信农林牧渔 |
| 100800119 | 中信食品饮料 |
| 100800118 | 中信医药 |
| 100800117 | 中信纺织服装 |
| 100800116 | 中信家电 |
| 100800114 | 中信商贸零售 |
| 100800113 | 中信汽车 |
| 100800112 | 中信国防军工 |
| 100800110 | 中信机械 |
| 100800109 | 中信轻工制造 |
| 100800108 | 中信建材 |
| 100800107 | 中信建筑 |
| 100800106 | 中信基础化工 |
| 100800105 | 中信钢铁 |
| 100800103 | 中信有色金属 |
| 100800102 | 中信煤炭 |
| 104770000 | 申万美容护理 |
| 104760000 | 申万环保 |
| 104750000 | 申万石油石化 |
| 104740000 | 申万煤炭 |
| 104730000 | 申万通信 |
| 104720000 | 申万传媒 |
| 104710000 | 申万计算机 |
| 104650000 | 申万国防军工 |
| 104640000 | 申万机械设备 |
| 104630000 | 申万电力设备 |
| 104620000 | 申万建筑装饰 |
| 104610000 | 申万建筑材料 |
| 104510000 | 申万综合 |
| 104490000 | 申万非银金融 |
| 104480000 | 申万银行 |
| 104460000 | 申万社会服务 |
| 104450000 | 申万商贸零售 |
| 104430000 | 申万房地产 |
| 104420000 | 申万交通运输 |
| 104410000 | 申万公用事业 |
| 104370000 | 申万医药生物 |
| 104360000 | 申万轻工制造 |
| 104350000 | 申万纺织服饰 |
| 104340000 | 申万食品饮料 |
| 104330000 | 申万家用电器 |
| 104280000 | 申万汽车 |
| 104270000 | 申万电子 |
| 104240000 | 申万有色金属 |
| 104230000 | 申万钢铁 |
| 104220000 | 申万基础化工 |
| 104110000 | 申万农林牧渔 |

### 查询观点/研报券商机构列表

| 机构ID | 机构名称 |
|---|---|
| C800150015 | 野村证券 |
| C800150624 | 星展银行 |
| C100000001 | 渤海证券 |
| C100000007 | 山西证券 |
| C100000009 | 西南证券 |
| C100000010 | 南京证券 |
| C100000011 | 世纪证券 |
| C100000012 | 中天证券 |
| C100000013 | 大通证券 |
| C100000014 | 华泰证券 |
| C100000016 | 东吴证券 |
| C100000017 | 东海证券 |
| C100000018 | 中山证券 |
| C100000019 | 国海证券 |
| C100000020 | 招商证券 |
| C100000022 | 开源证券 |
| C100000023 | 国信证券 |
| C100000024 | 方正证券 |
| C100000028 | 英大证券 |
| C100000029 | 光大证券 |
| C100000030 | 长城证券 |
| C100000031 | 平安证券 |
| C100000032 | 湘财证券 |
| C100000034 | 民生证券 |
| C100000035 | 长城国瑞证券 |
| C100000036 | 国元证券 |
| C100000037 | 东莞证券 |
| C100000038 | 华林证券 |
| C100000041 | 川财证券 |
| C100000042 | 东方证券 |
| C100000043 | 第一创业 |
| C100000044 | 大同证券 |
| C100000045 | 金融街证券 |
| C100000046 | 国联民生 |
| C100000048 | 首创证券 |
| C100000049 | 东方财富证券 |
| C100000051 | 兴业证券 |
| C100000052 | 华西证券 |
| C100000053 | 五矿证券 |
| C100000054 | 华金证券 |
| C100000055 | 华安证券 |
| C100000056 | 西部证券 |
| C100000057 | 联储证券 |
| C100000058 | 华鑫证券 |
| C100000061 | 华龙证券 |
| C100000062 | 中泰证券 |
| C100000063 | 天府证券 |
| C100000064 | 万联证券 |
| C100000065 | 国都证券 |
| C100000067 | 万和证券 |
| C100000068 | 华创证券 |
| C100000069 | 红塔证券 |
| C100000070 | 中银证券 |
| C100000071 | 华宝证券 |
| C100000072 | 国融证券 |
| C100000073 | 财达证券 |
| C100000075 | 浙商证券 |
| C100000076 | 金元证券 |
| C100000077 | 财信证券 |
| C100000078 | 爱建证券 |
| C100000079 | 中邮证券 |
| C100000080 | 中航证券 |
| C100000081 | 中原证券 |
| C100000082 | 华源证券 |
| C100000083 | 国盛证券 |
| C100000084 | 德邦证券 |
| C100000085 | 财通证券 |
| C100000086 | 诚通证券 |
| C100000088 | 江海证券 |
| C100000089 | 国开证券 |
| C100000090 | 太平洋 |
| C100000093 | 高盛中国证券 |
| C100000095 | 中信建投 |
| C100000096 | 国投证券 |
| C100000097 | 银泰证券 |
| C100000099 | 中国银河 |
| C100000100 | 信达证券 |
| C100000101 | 国新证券 |
| C100000102 | 东兴证券 |
| C100000103 | 北京证券 |
| C100000126 | 申港证券 |
| C100000128 | 华兴证券 |
| C100000129 | 东亚前海证券 |
| C100000130 | 汇丰前海证券 |
| C100000132 | 野村东方国际证券 |
| C100000133 | 摩根大通证券中国 |
| C100000135 | 甬兴证券 |
| C100000137 | 金圆统一证券 |
| C100000140 | 星展证券中国 |
| C100000004 | 华福证券 |
| C100000005 | 粤开证券 |
| C100000015 | 东北证券 |
| C100000025 | 麦高证券 |
| C100000060 | 上海证券 |
| C100000006 | 国金证券 |
| C100000008 | 海通证券 |
| C100000021 | 广发证券 |
| C100000026 | 中金公司 |
| C100000027 | 中信证券 |
| C100000039 | 长江证券 |
| C100000047 | 国泰海通 |
| C100000050 | 天风证券 |
| C100000098 | 瑞银证券 |
| C100000119 | 申万宏源证券 |
| C800040335 | 摩根士丹利 |
| C800065266 | 巴克莱 |
| C800070012 | 德意志银行 |
| C800105979 | 汇丰控股 |
| C800110443 | 高盛 |
| C800110523 | 美国银行 |
| C800114009 | 摩根大通 |
| C800014962 | 坎特菲茨杰拉德公司 |
| C800015193 | 巴西投资银行 |
| C800015458 | BMO Harris Bank |
| C800018355 | 奥尔巴赫格雷森投资 |
| C800019294 | Btic America Corporation |
| C800020171 | 联昌证券 |
| C800020225 | 奥地利第一储蓄银行 |
| C800020841 | 瑞士信贷集团 |
| C800021184 | Evercore |
| C800022831 | 里昂证券 |
| C800024532 | 道明证券 |
| C800033691 | 麦格理 |
| C800038847 | 古根海姆证券 |
| C800044779 | 加拿大皇家银行 |
| C800045141 | 美国投资银行派杰公司 |
| C800050267 | 法国兴业银行 |
| C800054695 | 威廉博莱公司 |
| C800055019 | Truist证券 |
| C800055550 | 韦德布什证券 |
| C801298117 | Barclays Bank |
| C801316708 | 北欧联合银行 |
| C801317677 | BNP Paribas SA |
| C801303042 | 杰富瑞集团 |
| C801304832 | 加拿大丰业银行 |
| C801196501 | 加拿大帝国商业银行 |
| C801196577 | 贝伦伯格资管 |
| C801196841 | 挪威DNB投资银行 |
| C801198303 | 富国证券 |
| C900006685 | 开普勒盛富证券 |
| C900006686 | 帕累托证券 |
| C900006687 | TD Securities |
| C900006694 | 国民银行 |
| C801342605 | 蒙特利尔银行 |
| C900006697 | BTIG |
| C100000092 | 高华证券 |
| C100000066 | 恒泰长财 |
| C100000091 | 中天国富 |
| C100000107 | 国联民生证券承销保荐 |
| C100000104 | 中德证券 |
| C100000117 | 金通证券 |
| C800016741 | 伯恩斯坦研究 |
| C800080335 | 高盛集团 |
| C800090764 | 花旗银行 |
| C800127057 | 瑞银集团 |
| C800082057 | 高盛 |
| C801352341 | 法巴证券中国 |
| C500000318 | 上海申银万国证券研究所 |
| C800070011 | 大和证券 |
| C801318100 | 法国兴业银行 |
| C900005224 | 摩根大通 |
| C800025530 | 银河海外 |
| C800041439 | 加拿大皇家银行 |
| C800051885 | 瑞银 |
| C801342334 | 瑞士信贷 |
| C800031261 | 杰富瑞金融 |
| C800160866 | 中信里昂证券 |
| C801322814 | 挪威银行 |
| C801165257 | 德意志银行 |
| C800013239 | 加拿大帝国商业银行 |
| C800035749 | 贝伦伯格银行 |
| C800103054 | 蒙特利尔银行 |
| C800100302 | 加拿大丰业银行 |
| C800103710 | National Bank of Canada |
| C800041170 | Piper Sandler |
| C800090327 | 花旗 |
| C800142261 | 威廉博莱 |
| C800096075 | 海通国际 |
| C900001246 | 国盛证券 |
| C801361610 | 国金证券公司 |

### 查询路演/调研/线下策略会/会议纪要机构列表

| 机构ID | 机构名称 |
|---|---|
| C000000000 | 公司自发 |
| C100000006 | 国金证券 |
| C100000015 | 东北证券 |
| C100000016 | 东吴证券 |
| C100000019 | 国海证券 |
| C100000021 | 广发证券 |
| C100000022 | 开源证券 |
| C100000023 | 国信证券 |
| C100000024 | 方正证券 |
| C100000026 | 中金公司 |
| C100000027 | 中信证券 |
| C100000034 | 民生证券 |
| C100000039 | 长江证券 |
| C100000042 | 东方证券 |
| C100000050 | 天风证券 |
| C100000051 | 兴业证券 |
| C100000052 | 华西证券 |
| C100000056 | 西部证券 |
| C100000062 | 中泰证券 |
| C100000068 | 华创证券 |
| C100000075 | 浙商证券 |
| C100000083 | 国盛证券 |
| C100000084 | 德邦证券 |
| C100000085 | 财通证券 |
| C100000096 | 国投证券 |
| C100000099 | 银河证券 |
| C100000100 | 信达证券 |
| C100000020 | 招商证券 |
| C100000029 | 光大证券 |
| C100000014 | 华泰证券 |
| C100000058 | 华鑫证券 |
| C100000090 | 太平洋证券 |
| C100000055 | 华安证券 |
| C100000009 | 西南证券 |
| C100000080 | 中航证券 |
| C200000294 | 泓德基金 |
| C100000046 | 国联民生证券 |
| C100000049 | 东方财富证券 |
| C100000048 | 首创证券 |
| C100000030 | 长城证券 |
| C100000004 | 华福证券 |
| C100000053 | 五矿证券 |
| C100000128 | 华兴证券 |
| C100000060 | 上海证券 |
| C100000129 | 东亚前海证券 |
| C100000092 | 高华证券 |
| C100000130 | 汇丰前海证券 |
| C100000031 | 平安证券 |
| C100000007 | 山西证券 |
| C100000126 | 申港证券 |
| C100000132 | 野村东方国际 |
| C100000079 | 中邮证券 |
| C100000041 | 川财证券 |
| C900005224 | 摩根大通 |
| C100000103 | 北京证券 |
| C900000031 | 帕米尔研究 |
| C800399320 | 天天基金 |
| C100000102 | 东兴证券 |
| C200000203 | 嘉实基金 |
| C801190083 | 国富基金 |
| C200000202 | 华安基金 |
| C200000293 | 天弘基金 |
| C100000071 | 华宝证券 |
| C200000187 | 兴业基金 |
| C200000181 | 九泰基金 |
| C200000168 | 工银瑞信基金 |
| C200000165 | 华夏基金 |
| C800726698 | 慧衍基金 |
| C800250920 | 汇成基金 |
| C800070921 | 第一上海证券 |
| C100000036 | 国元证券 |
| C100000017 | 东海证券 |
| C100000119 | 申万宏源证券 |
| C100000047 | 国泰海通 |
| C100000095 | 中信建投 |
| C200000163 | 易方达基金 |
| C200000207 | 万家基金 |
| C200000265 | 大成基金 |
| C200000173 | 国金基金 |
| C200000270 | 招商基金 |
| C200000276 | 平安基金 |
| C200000190 | 广发基金 |
| C100000070 | 中银证券 |
| C200000263 | 鹏华基金 |
| C100000054 | 华金证券 |
| C200000201 | 国泰基金 |
| C200000170 | 华商基金 |
| C100000135 | 甬兴证券 |
| C200000223 | 汇添富基金 |
| C200000228 | 中欧基金 |
| C800164483 | 中银国际证券 |
| C100000082 | 华源证券 |
| C200000300 | 南华基金 |
| C100000078 | 爱建证券 |
| C100000001 | 渤海证券 |
| C100000073 | 财达证券 |
| C100000081 | 中原证券 |
| C100000044 | 大同证券 |
| C100000037 | 东莞证券 |
| C100000005 | 粤开证券 |
| C100000028 | 英大证券 |
| C100000065 | 国都证券 |
| C100000097 | 银泰证券 |
| C100000045 | 金融街证券 |
| C100000063 | 宏信证券 |
| C100000032 | 湘财证券 |
| C100000064 | 万联证券 |
| C100000011 | 世纪证券 |
| C100000010 | 南京证券 |
| C100000076 | 金元证券 |
| C100000088 | 江海证券 |
| C100000101 | 国新证券 |
| C100000086 | 诚通证券 |
| C200000275 | 民生加银基金 |
| C200000272 | 景顺长城基金 |
| C600000255 | 恒泰期货 |
| C100000061 | 华龙证券 |
| C600000293 | 南华期货 |
| C600000301 | 中州期货 |
| C600000275 | 国联期货 |
| C600000312 | 国信期货 |
| C600000253 | 光大期货 |
| C600000358 | 平安期货 |
| C600000292 | 新湖期货 |
| C600000267 | 东证期货 |
| C600000333 | 广发期货 |
| C600000304 | 徽商期货 |
| C600000237 | 兴证期货 |
| C100000025 | 麦高证券 |
| C600000221 | 国泰君安期货 |

### 查询行业分类枚举

#### 中信行业分类

| 行业名称 | 行业id |
|---|---|
| 石油石化 | 100800101 |
| 煤炭 | 100800102 |
| 有色金属 | 100800103 |
| 电公 | 100800104 |
| 钢铁 | 100800105 |
| 基础化工 | 100800106 |
| 建筑 | 100800107 |
| 建材 | 100800108 |
| 轻工制造 | 100800109 |
| 机械 | 100800110 |
| 电新 | 100800111 |
| 国防军工 | 100800112 |
| 汽车 | 100800113 |
| 商贸零售 | 100800114 |
| 消服 | 100800115 |
| 家电 | 100800116 |
| 纺织服装 | 100800117 |
| 医药 | 100800118 |
| 食品饮料 | 100800119 |
| 农林牧渔 | 100800120 |
| 银行 | 100800121 |
| 非银 | 100800122 |
| 房地产 | 100800123 |
| 综合金融 | 100800124 |
| 交通运输 | 100800125 |
| 电子 | 100800126 |
| 通信 | 100800127 |
| 计算机 | 100800128 |
| 传媒 | 100800129 |
| 综合 | 100800130 |

#### 申万行业分类

| 行业名称 | 行业id |
|---|---|
| 公用事业 | 104410000 |
| 机械设备 | 104640000 |
| 电力设备 | 104630000 |
| 美容护理 | 104770000 |
| 商贸零售 | 104450000 |
| 通信 | 104730000 |
| 房地产 | 104430000 |
| 交通运输 | 104420000 |
| 国防军工 | 104650000 |
| 轻工制造 | 104360000 |
| 汽车 | 104280000 |
| 煤炭 | 104740000 |
| 环保 | 104760000 |
| 食品饮料 | 104340000 |
| 计算机 | 104710000 |
| 有色金属 | 104240000 |
| 非银金融 | 104490000 |
| 综合 | 104510000 |
| 建筑装饰 | 104620000 |
| 纺织服饰 | 104350000 |
| 家用电器 | 104330000 |
| 医药生物 | 104370000 |
| 钢铁 | 104230000 |
| 社会服务 | 104460000 |
| 农林牧渔 | 104110000 |
| 银行 | 104480000 |
| 传媒 | 104720000 |
| 基础化工 | 104220000 |
| 建筑材料 | 104610000 |
| 石油石化 | 104750000 |
| 电子 | 104270000 |


## 3. Insight 接口

### 查询路演列表

**请求 URL**

- `https://open.gangtise.com/application/open-insight/schedule/roadshow/getList`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，从 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| from | 是 | Integer | 0 | 分页参数：请求开始位置(条数) |
| size | 是 | Integer | 20 | 分页参数：单页数量，最大值为50 |
| startTime | 否 | String | - | 开始时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| endTime | 否 | String | - | 结束时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| keyword | 否 | String | - | 搜索关键词 |
| researchAreaList | 否 | List<String> | - | 路演所属的研究方向，研究方向ID请查阅 【研究方向分类】 |
| institutionList | 否 | List<String> | - | 路演的牵头机构列表，机构ID请查阅 【机构列表】 |
| securityList | 否 | List<String> | - | 路演关联的证券列表，证券代码格式如 ["000001.SZ"] |
| categoryList | 否 | List<String> | - | 路演类型： earningsCall-业绩会、 strategyMeeting-策略会、 companyAnalysis-公司分析、 industryAnalysis-行业分析、 fundRoadshow-基金路演 |
| marketList | 否 | List<String> | - | 市场列表：aShares-A股、 hkStocks-港股、 usChinaConcept-美股中概、 usStocks-美股 |
| participantRoleList | 否 | List<String> | - | 路演参会人标识： management-高管、 expert-专家 |
| brokerTypeList | 否 | List<String> | - | 路演牵头卖方类型： cnBroker-中资卖方、 otherBroker-外资卖方 |
| permission | 否 | List<Integer> | - | 权限类型：1-公开、 2-私密；公开日程为Gangtise在金融市场各公开渠道获取的日程信息，私密日程为用户所在机构独享的日程信息 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| roadshowId | String | 路演业务唯一标识 |
| title | String | 路演标题 |
| startTime | String | 路演起始时间（东八区），格式严格为yyyy-MM-dd HH:mm:ss |
| endTime | String | 路演结束时间（东八区），格式严格为yyyy-MM-dd HH:mm:ss |
| abstractInfo | String | 路演简介 |
| category | String | 路演分类（如"strategyMeeting"） |
| securityList | List<Object> | 日程关联的证券集合 |
| ↳ securityCode | String | 证券代码（如"000001.SZ"） |
| ↳ securityName | String | 证券名称（如"贵州茅台"） |
| institutionList | List<Object> | 日程的牵头机构信息集合 |
| ↳ institutionId | String | 牵头机构ID（如"C100000027"） |
| ↳ institutionName | String | 牵头机构名称（如"长江证券"） |
| contact | String | 日程对接销售汇总 |
| researchAreaList | List<Object> | 日程关联的研究方向集合 |
| ↳ researchAreaId | String | 研究方向ID（如"10464000"） |
| ↳ researchAreaName | String | 研究方向名称（如"策略"） |
| conceptList | List<Object> | 日程关联的主题概念集合 |
| ↳ conceptId | String | 主题概念ID（如"104640032"） |
| ↳ conceptName | String | 主题概念名称（如"机器人"） |
| participant | String | 日程参与人员（如"嘉宾:董秘,主持人:首席分析师"） |
| participantRoleList | List<String> | 路演参会人标识（如["management"]） |
| location | String | 日程具体地点（如"上海国家会展中心"） |
| schedulePlan | String | 日程的行程安排 |
| permission | Integer | 权限类型：1-公开、2-私密 |

### 查询调研列表

**请求 URL**

- `https://open.gangtise.com/application/open-insight/schedule/site-visit/getList`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| from | 是 | Integer | 0 | 分页参数：请求开始位置(条数) |
| size | 是 | Integer | 20 | 分页参数：单页数量，最大值为50 |
| startTime | 否 | String | - | 开始时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| endTime | 否 | String | - | 结束时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| keyword | 否 | String | - | 搜索关键词 |
| researchAreaList | 否 | List<String> | - | 调研所属的研究方向，研究方向ID请查阅 【研究方向分类】 |
| securityList | 否 | List<String> | - | 调研关联的证券列表，证券代码格式如 ["000001.SZ"] |
| institutionList | 否 | List<String> | - | 调研的牵头机构列表，机构ID请查阅 【机构列表】 |
| objectList | 否 | List<String> | - | 调研类型： company-公司调研、 industry-行业调研 |
| categoryList | 否 | List<String> | - | 调研形式： single-单场调研、 series-系列调研 |
| marketList | 否 | List<String> | - | 市场列表： aShares-A股、 hkStocks-港股、 usChinaConcept-美股中概、 usStocks-美股 |
| permission | 否 | List<Integer> | - | 权限类型： 1-公开、 2-私密；公开日程为Gangtise在金融市场各公开渠道获取的日程信息，私密日程为用户所在机构独享的日程信息 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| siteVisitId | String | 调研业务唯一标识 |
| title | String | 调研标题 |
| startTime | String | 调研起始时间（东八区），格式严格为yyyy-MM-dd HH:mm:ss |
| endTime | String | 调研结束时间（东八区），格式严格为yyyy-MM-dd HH:mm:ss |
| abstractInfo | String | 调研简介 |
| object | String | 调研分类（如"company"） |
| category | String | 调研形式（如"single"） |
| securityList | List<Object> | 日程关联的证券集合 |
| ↳ securityCode | String | 证券代码（如"000001.SZ"） |
| ↳ securityName | String | 证券名称（如"贵州茅台"） |
| institutionList | List<Object> | 日程的牵头机构信息集合 |
| ↳ institutionId | String | 牵头机构ID（如"C100000027"） |
| ↳ institutionName | String | 牵头机构名称（如"长江证券"） |
| contact | String | 日程对接销售汇总 |
| researchAreaList | List<Object> | 日程关联的研究方向集合 |
| ↳ researchAreaId | String | 研究方向ID（如"104640000"） |
| ↳ researchAreaName | String | 研究方向名称（如"策略"） |
| conceptList | List<Object> | 日程关联的主题概念集合 |
| ↳ conceptId | String | 主题概念ID（如"104640032"） |
| ↳ conceptName | String | 主题概念名称（如"机器人"） |
| participant | String | 日程参与人员（如"嘉宾:董秘,主持人:首席分析师"） |
| location | String | 日程具体地点（如"上海国家会展中心"） |
| schedulePlan | String | 日程的行程安排 |
| permission | Integer | 权限类型：1-公开、2-私密 |

### 查询线下策略会列表

**请求 URL**

- `https://open.gangtise.com/application/open-insight/schedule/strategy-meeting/getList`

**请求方式**：`POST`

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| from | 是 | Integer | 0 | 分页参数：请求开始位置(条数) |
| size | 是 | Integer | 20 | 分页参数：单页数量，最大值为50 |
| startTime | 否 | String | - | 开始时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| endTime | 否 | String | - | 结束时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| keyword | 否 | String | - | 搜索关键词 |
| institutionList | 否 | List<String> | - | 策略会牵头机构列表，机构ID请查阅 【机构列表】 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

### 查询论坛列表

**请求 URL**

- `https://open.gangtise.com/application/open-insight/schedule/forum/getList`

**请求方式**：`POST`

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| from | 是 | Integer | 0 | 分页参数：请求开始位置(条数) |
| size | 是 | Integer | 20 | 分页参数：单页数量，最大值为50 |
| startTime | 否 | String | - | 开始时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| endTime | 否 | String | - | 结束时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| keyword | 否 | String | - | 搜索关键词 |
| securityList | 否 | List<String> | - | 论坛关联的证券列表，证券代码格式如 ["000001.SZ"] |
| researchAreaList | 否 | List<String> | - | 论坛所属的研究方向，研究方向ID请查阅 【研究方向分类】 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

### 查询内资研报列表

**请求 URL**

- `https://open.gangtise.com/application/open-insight/broker-report/getList`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| from | 是 | Integer | 0 | 分页参数：请求开始位置(条数) |
| size | 是 | Integer | 20 | 分页参数：单页数量，最大值为50 |
| startTime | 否 | String | - | 开始时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| endTime | 否 | String | - | 结束时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| searchType | 否 | Integer | 1 | 搜索类型：1-标题搜索 2-全文搜索 |
| rankType | 否 | Integer | 1 | 返回搜索结果排序方式：1-综合排序 2-时间倒序 |
| keyword | 否 | String | - | 搜索关键词 |
| categoryList | 否 | List<String> | - | 研报类别：macro-宏观研究 strategy-策略研究 industry-行业研究 company-公司研究 bond-债券研究 quant-金融工程 morningNotes-晨会研究 fund-基金研究 forex-外汇研究 futures-期货研究 options-期权研究 warrants-权证研究 market-市场研究 wealthManagement-理财研究 other-其他报告 |
| industryList | 否 | List<String> | - | 研报所属行业列表(仅行业研究和公司研究类型生效)，行业ID请查阅 【行业分类】 |
| securityList | 否 | List<String> | - | 研报所属证券列表(仅公司研究类型生效)，格式如["000001.SZ"] |
| brokerList | 否 | List<String> | - | 发布研报的券商列表，券商ID请查阅 【券商列表】 |
| llmTagList | 否 | List<String> | - | 大模型语义解析投研业务标签 语义标签： inDepth-深度报告 earningsReview-业绩点评 industryStrategy-行业策略 |
| ratingList | 否 | List<String> | - | 研报评级： buy-买入 overweight-增持 neutral-中性 underweight-减持 sell-卖出 |
| ratingChangeList | 否 | List<String> | - | 研报评级变动： upgrade-上调 maintain-维持 downgrade-下调 initiate-首次 |
| minReportPages | 否 | Integer | - | 研报最小页数 |
| maxReportPages | 否 | Integer | - | 研报最大页数 |
| sourceList | 否 | List<String> | - | 数据源类型：1-PDF研报，2-公众号 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| reportId | String | 研报业务唯一标识 |
| title | String | 研报标题 |
| brief | String | 研报摘要 |
| reportDate | String | 研报中注明的报告日期，格式为 yyyy-MM-dd |
| publishTime | String | 研报发布的具体时间（东八区），格式严格为yyyy-MM-dd HH:mm:ss |
| category | String | 研报所属分类标识（如："industry"） |
| llmTagList | List<String> | 投研业务标签集合（如：["inDepth","earningsReview"]） |
| publisher | Object | 研报的发布者信息集合 |
| ↳ brokerId | String | 发布研报的券商ID（如 "C100000022"） |
| ↳ brokerName | String | 发布研报的券商名称（如 "国金证券"） |
| ↳ author | String | 研报作者名称集合（如："张三，李四"） |
| securityList | List<Object> | 研报关联的证券集合 |
| ↳ securityCode | String | 证券代码（如 "000001.SZ"） |
| ↳ securityName | String | 证券名称（如 "贵州茅台"） |
| ↳ rating | String | 证券的评级（如："buy"，若无则返回 null） |
| ↳ ratingChange | String | 证券的评级变动（如："maintain"，若无则返回 null） |
| industryList | List<Object> | 研报关联的行业集合 |
| ↳ industryId | String | 行业ID（如 "104640000"） |
| ↳ industryName | String | 行业名称（如 "中信食品饮料"） |
| ↳ rating | String | 行业的评级（如："buy"，若无则返回 null） |
| ↳ ratingChange | String | 行业的评级变动（如："maintain"，若无则返回 null） |
| pageNumber | Integer | 研报页数 |
| source | Integer | 数据源类型：1-PDF研报，2-公众号 |

### 下载内资研报文件

**请求 URL**

- `https://open.gangtise.com/application/open-insight/broker-report/download/file`

**请求方式**：`GET`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| reportId | 是 | String | - | 研报列表接⼝返回的业务唯⼀标识 |
| fileType | 否 | Integer | 1 | 返回⽂件类型： 1 -原始 PDF 2 -Markdown |

### 查询外资研报列表

**请求 URL**

- `https://open.gangtise.com/application/open-insight/foreign-report/getList`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| from | 是 | Integer | 0 | 分页参数：请求开始位置(条数) |
| size | 是 | Integer | 20 | 分页参数：单页数量，最大值为50 |
| startTime | 否 | String | - | 开始时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| endTime | 否 | String | - | 结束时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全） |
| searchType | 否 | Integer | 1 | 搜索类型：1-标题搜索 2-全文搜索 |
| rankType | 否 | Integer | 1 | 返回搜索结果排序方式：1-综合排序 2-时间倒序 |
| keyword | 否 | String | - | 搜索关键词 |
| categoryList | 否 | List<String> | - | 研报类别：macro-宏观研究 strategy-策略研究 industry-行业研究 company-公司研究 bond-债券研究 quant-金融工程 morningNotes-晨会研究 fund-基金研究 forex-外汇研究 futures-期货研究 options-期权研究 warrants-权证研究 market-市场研究 wealthManagement-理财研究 other-其他报告 |
| regionList | 否 | List<String> | - | 研报所属区域列表，区域ID请查阅 【区域分类】 |
| industryList | 否 | List<String> | - | 研报所属行业列表(仅行业研究类型生效)，行业ID请查阅 【行业分类】 |
| securityList | 否 | List<String> | - | 研报所属的证券列表（当填写股票代码时，仅对公司研究生效），证券代码格式如["UBER.N"]， 【境外股票代码格式规范见列表】 |
| brokerList | 否 | List<String> | - | 发布研报的券商列表，券商ID请查阅 【券商列表】 |
| llmTagList | 否 | List<String> | - | 大模型语义解析投研业务标签 语义标签： inDepth-深度报告 earningsReview-业绩点评 industryStrategy-行业策略 |
| ratingList | 否 | List<String> | - | 研报评级： buy-买入 overweight-增持 neutral-中性 underweight-减持 sell-卖出 |
| ratingChangeList | 否 | List<String> | - | 研报评级变动： upgrade-上调 maintain-维持 downgrade-下调 initiate-首次 |
| minReportPages | 否 | Integer | - | 研报最小页数 |
| maxReportPages | 否 | Integer | - | 研报最大页数 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| reportId | String | 研报业务唯一标识 |
| title | String | 研报标题 |
| titleTranslate | String | 研报标题的中文翻译 |
| brief | String | 研报摘要 |
| briefTranslate | String | 研报摘要的中文翻译 |
| reportDate | String | 研报中注明的报告日期，格式为 yyyy-MM-dd |
| publishTime | String | 研报发布的具体时间（东八区），格式严格为yyyy-MM-dd HH:mm:ss |
| hasTranslate | Boolean | 研报是否有对应翻译文件（true-有 false-没有） |
| category | String | 研报所属分类标识（如："industry"） |
| llmTagList | List<String> | 投研业务标签集合（如：["inDepth","earningsReview"]） |
| publisher | Object | 研报的发布者信息集合 |
| ↳ brokerId | String | 发布研报的券商ID（如 "C800114009"） |
| ↳ brokerName | String | 发布研报的券商名称（如 "摩根大通"） |
| securityList | List<Object> | 研报关联的证券集合 |
| ↳ securityCode | String | 证券代码（如 "UBER.N"） |
| ↳ securityName | String | 证券名称（如 "优步"） |
| ↳ rating | String | 证券的评级（如："buy"，若无则返回 null） |
| ↳ ratingChange | String | 证券的评级变动（如："maintain"，若无则返回 null） |
| industryList | List<Object> | 研报关联的行业集合 |
| ↳ industryId | String | 行业ID（如 "104640000"） |
| ↳ industryName | String | 行业名称（如 "申万食品饮料"） |
| ↳ rating | String | 行业的评级（如："buy"，若无则返回 null） |
| ↳ ratingChange | String | 行业的评级变动（如："maintain"，若无则返回 null） |
| pageNumber | Integer | 研报页数 |

### 下载外资研报文件

**请求 URL**

- `https://open.gangtise.com/application/open-insight/foreign-report/download/file`

**请求方式**：`GET`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| reportId | 是 | String | - | 研报列表接⼝返回的业务唯⼀标识 |
| fileType | 否 | Integer | 1 | 返回⽂件类型： 1 -原始 PDF 2 -Markdown 3-中文翻译PDF 4-中文翻译Markdown |

### 查询公告列表

**请求 URL**

- `https://open.gangtise.com/application/open-insight/announcement/getList`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| from | 是 | Integer | 0 | 分页参数：请求开始位置(条数) |
| size | 是 | Integer | 20 | 分页参数：单页数量，最大值为 50 |
| startTime | 否 | Long | - | 起始时间（严格约束为13位时间戳） |
| endTime | 否 | Long | - | 结束时间（严格约束为13位时间戳） |
| searchType | 否 | Integer | 1 | 搜索类型：1-标题搜索 2-全文搜索 |
| rankType | 否 | Integer | 1 | 返回搜索结果排序方式： 1-综合排序 2-时间倒序 |
| keyword | 否 | String | - | 搜索关键词 |
| categoryList | 否 | List<String> | - | 公告的分类列表，类型ID请查阅 【公告分类】 |
| securityList | 否 | List<String> | - | 公告所属的证券列表，证券代码格式如 ["000001.SZ"] |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| announcementId | String | 公告业务唯一标识 |
| title | String | 公告标题 |
| announcementDate | String | 公告中注明的日期，格式为 yyyy-MM-dd |
| publishTime | Long | 公告发布的具体时间（严格约束为13位时间戳） |
| securityCode | String | 证券代码（如 "000001.SZ"） |
| securityName | String | 证券名称（如 "贵州茅台"） |
| primaryCategory | Object | 公告一级分类 |
| ↳ categoryId | String | 公告一级分类ID（如 "103910700"） |
| ↳ categoryName | String | 公告一级分类名称（如 "股权股本"） |
| secondaryCategory | Object | 公告二级分类 |
| ↳ categoryId | String | 公告二级分类ID（如 "103910705"） |
| ↳ categoryName | String | 公告二级分类名称（如 "股权回购"） |
| sourceId | String | 公告来源ID（如 "100100362"） |
| sourceName | String | 公告来源名称（如 "上海证券交易所"） |

### 下载公告文件

**请求 URL**

- `https://open.gangtise.com/application/open-insight/announcement/download/file`

**请求方式**：`GET`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| announcementId | 是 | String | - | 公告id |
| fileType | 否 | Integer | 1 | 返回⽂件类型： 1 -原始 PDF 2 -Markdown |


## 4. Quote 接口

### 查询主营构成

**请求 URL**

- `https://open.gangtise.com/application/open-quote/main-business/getList`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| securityCode | 是 | String | - | 股票代码 |
| startDate | 否 | String | endDate往前三年 | 开始⽇期，格式严格为 yyyy-MM-dd |
| endDate | 否 | String | 当前日期 | 结束⽇期，格式严格为 yyyy-MM-dd |
| period | 否 | String | - | 报告期： interim -中报 annual -年报 |
| fieldList | 否 | List<String> | - | 可提取的指标：opRevenue -营业收⼊ opRevenueYoy -营业收⼊同⽐增速 opRevenueRatio -营业收⼊占⽐ opCost -营业成本 opCostYoy -营业成本同⽐增速 opCostRatio -营业成本占⽐ grossProfit -⽑利 grossProfitYoy -⽑利同⽐增速 grossProfitRatio -⽑利占⽐ grossMargin -⽑利率 grossMarginYoy -⽑利率同⽐增速 grossMarginRatio -⽑利率占⽐ |
| breakdown | 是 | String | product | 提取维度： product -按产品拆分 industry -按⾏业拆分 region -按地区拆分 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| securityCode | String | 证券代码 |
| securityName | String | 证券名称 |
| breakdown | String | 提取维度：如 product |
| categoryDetail | List<String> | 所选提取维度下细分类型名称，如： product：茅台酒 、系列酒、其他业务、其他系列酒 industry：酒类、其他业务 region： 国内、国外、其他业务 |
| fieldList | List<String> | 数据列字段列表，定义下⽅ list 数组中每个数据组的含义 |
| ↳ periodName | String | 报告期中⽂名，如 2025年中报 （固定字段） |
| ↳ periodEndDate | String | 该报告期的截⽌⽇期，如 2025-06-30 （固定字段） |
| ↳ categoryName | String | 包含所选提取维度下细分类型名称，如： 茅台酒、国内 ； 合计：表示公司整体。（固定字段） |
| ↳ opRevenue | Double | 营业收⼊（可选字段） |
| ↳ opRevenueYoy | Double | 营业收⼊同⽐增速 （%）（可选字段） |
| ↳ opRevenueRatio | Double | 营业收⼊同⽐占⽐ （%）（可选字段） |
| ↳ opCost | Double | 营业成本（可选字段） |
| ↳ opCostYoy | Double | 营业成本同⽐增速 （%） |
| ↳ opCostRatio | Double | 营业成本占⽐ （%）（可选字段） |
| ↳ grossProfit | Double | ⽑利（可选字段） |
| ↳ grossProfitYoy | Double | ⽑利同⽐增速 （%）（可选字段） |
| ↳ grossProfitRatio | Double | ⽑利占⽐ （%）（可选字段） |
| ↳ grossMargin | Double | ⽑利率 （%）（可选字段） |
| ↳ grossMarginYoy | Double | ⽑利率同⽐增速 （%）（可选字段） |
| ↳ grossMarginRatio | Double | ⽑利率占⽐ （%）（可选字段） |

### 查询估值分析

**请求 URL**

- `https://open.gangtise.com/application/open-quote/valuation-analysis/getList`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| securityCode | 是 | String; | - | 股票代码 |
| indicator | 是 | String | – | 估值指标，⽀持：• peTtm (滚动市盈率) • pbMrq (市净率) • peg (市盈率相对盈利增⻓⽐率) • psTtm (滚动市销率) • pcfTtm (滚动市现率) • em (企业倍数) |
| startDate | 否 | String | 结束日期一年前 | 开始⽇期，格式严格为 yyyy-MM-dd |
| endDate | 否 | String | 当前日期 | 结束⽇期，格式严格为 yyyy-MM-dd |
| limit | 否 | Integer | 2000 | 单次请求最⼤返回⾏数(系统最⾼上限为10000 ⾏，超过该限制请缩短⽇期区间分批拉取) |
| fieldList | 否 | List<String> | - | 从返回参数中指定返回的字段，不指定返回全部 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| indicator | String | 估值指标名称（如： "peTtm" ） |
| fieldList | List<String> | 列名表头。严格与请求的 fieldList 顺序⼀致，定义了下⽅list中每个数据组的含义 |
| tradeDate | String | 交易⽇期，格式为 yyyy-MM-dd (固定字段) |
| value | Double | 原始值 |
| percentileRank | Double | 分位点 |
| average | Double | 平均值 |
| median | Double | 中位数 |
| p10 | Double | 10分位数 |
| p25 | Double | 25分位数 |
| p75 | Double | 75分位数 |
| p90 | Double | 90分位数 |
| upper1Std | Double | +1标准差 |
| lower1Std | Double | -1标准差 |

#### 参数说明补充

- `indicator` 为必填，支持：`peTtm` / `pbMrq` / `peg` / `psTtm` / `pcfTtm` / `em`。

## 5. AI 接口

### 知识库批量查询

**请求 URL**

- `https://open.gangtise.com/application/open-data/ai/search/knowledge/batch`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 说明 |
|---|---|---|---|
| queries | 是 | List<String> | 查询条件列表，最大支持5个查询条件 |
| top | 否 | Integer | 返回文档数量，默认10，最大支持20 |
| resourceTypes | 否 | List<Integer> | 知识库资源类型列表 10：券商研究报告 11：外资研究报告 20：内部研究报告 40：首席分析师观点 50：公司公告 51：港股公告 60：会议平台纪要 70：调研纪要公告 80：网络资源纪要 90：产业公众号 |
| knowledgeNames | 否 | List<String> | 知识库类型（默认只使用系统库） system_knowledge_doc：系统库 tenant_knowledge_doc： 租户库 |
| startTime | 否 | Long | 数据查询开始时间（13位时间戳） |
| endTime | 否 | Long | 数据查询结束时间（13位时间戳） |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| query | String | 查询问题 |
| data | List<Object> | 查询结果 |
| data.content | String | 文本切片内容 |
| data.extraInfo | Object | 额外信息，目前包含页定位信息 |
| data.extraInfo.position | Object | 文件分片信息 |
| data.extraInfo.position.page | List<Integer> | 当前切片所在页数组 |
| data.extraInfo.position.totalPages | Integer | 文件总页数 |
| data.extraInfo.position.polygon | List<Double> | 位置多边形，暂无实际数据 |
| data.resourceType | Long | 资源类型，如：券商研报为10 |
| data.knowledgeName | String | 知识库名称 |
| data.time | Long | 文件时间 |
| data.sourceId | String | 溯源id |
| data.title | String | 文件标题 |
| data.company | String | 公司 |
| data.industry | String | 行业 |

### 知识库溯源/资源下载

**请求 URL**

- `https://open.gangtise.com/application/open-data/ai/resource/download`

**请求方式**：`GET`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 说明 |
|---|---|---|---|
| resourceType | 是 | Integer | 资源类型： 10：券商研究报告 11：外资券商研究报告 20：内部研究报告 50：公司公告 60：会议平台纪要 70：调研纪要公告 80：网络资源纪要 90：产业公众号 |
| sourceId | 是 | String | 资源Id |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| url | String | 第三方资源链接地址 |

#### 返回说明

- 该接口实际联调中可能返回 **纯文本正文**、**JSON 外链 URL**，或在权限/数据不匹配时返回业务错误码。
### 投研线索

**请求 URL**

- `https://open.gangtise.com/application/open-ai/security-clue/getList`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | 通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| from | 是 | Integer | 0 | 分页参数：请求开始位置(条数) |
| size | 是 | Integer | 500 | 分页参数：单页数量，最大值为 500 |
| startTime | 是 | String | - | 开始时间，支持格式：yyyy-MM-dd或yyyy-MM-ddHH:mm:ss |
| endTime | 是 | String | - | 结束时间，支持格式：yyyy-MM-dd或yyyy-MM-ddHH:mm:ss |
| queryMode | 是 | String | - | 查询方式， 按证券查询-bySecurity、 按行业查询-byIndustry， |
| gtsCodeList | 否 | List<String> | - | 需查询线索的证券/行业代码列表，查询方式为按证券查询bySecurity时，传入的代码列表中只能是证券代码，如["000001.SZ","000063.SH"] ，列表中不能含行业代码； 同理，查询方式为按行业查询byIndustry时，列表中不能含证券代码。行业代码请查阅行业代码（参考 【申万行业代码】 ） 不传代码列表时，会按照传入的查询方式来查询指定时间区间内该方式下的所有结果，可能导致条数过多，请谨慎使用 |
| source | 否 | List<String> | - | 线索来源筛选，支持多选： 研报researchReport、 电话会议（纪要）conference、 公告announcement、 观点view |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| total | Integer | 总条数 |
| list | List<Object> | 数据列表 |
| ↳ source | String | 线索来源，研报researchReport、 电话会议(纪要)conference、 公告announcement、 观点view |
| ↳ publishTime | String | 线索时间，格式：yyyy-MM-ddHH:mm:ss，如：2026-03-09 00:00:00 |
| ↳ title | String | 线索标题 |
| ↳ securityContent | String | 证券线索 |
| ↳ industryContent | String | 行业线索 |
| ↳ partyId | String | 发布者ID，如C100000039 |
| ↳ partyName | String | 发布者简称，如铜牛信息 |
| ↳ gtsCode | String | 证券代码或行业代码，对应传入的以查询线索的证券/行业代码，如：601225.SH |
| ↳ gtsName | String | 证券代码或行业代码对应的简称，如：陕西煤业 |

### 一页通 Agent

**请求 URL**

- `https://open.gangtise.com/application/open-ai/agent/one-pager`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | 通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| securityCode | 是 | String | - | 证券代码，如 600519.SH ，支持 A 股、港股 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| code | String | 响应码， 000000 表示正常 |
| msg | String | 请求结果消息提示 |
| status | Boolean | 请求执行状态， true 表示成功 |
| data | Object | 返回内容对象 |
| ↳ date | String | 一页通生成时间，格式： yyyy-MM-dd |
| ↳ content | String | 公司一页通具体内容，Markdown 字符串 |

#### 参数说明补充

- 这些 Agent 接口的核心入参是 `securityCode`，不是自由文本 `query`。
### 投资逻辑 Agent

**请求 URL**

- `https://open.gangtise.com/application/open-ai/agent/investment-logic`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | 通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| securityCode | 是 | String | - | 证券代码，如 600519.SH ，支持 A 股、港股 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| code | String | 响应码， 000000 表示正常 |
| msg | String | 请求结果消息提示 |
| status | Boolean | 请求执行状态， true 表示成功 |
| data | Object | 返回内容对象 |
| ↳ date | String | 投资逻辑生成时间，格式： yyyy-MM-dd |
| ↳ content | String | 公司投资逻辑具体内容，Markdown 字符串 |

#### 参数说明补充

- 这些 Agent 接口的核心入参是 `securityCode`，不是自由文本 `query`。
### 同业对比 Agent

**请求 URL**

- `https://open.gangtise.com/application/open-ai/agent/peer-comparison`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | 通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| securityCode | 是 | String | - | 证券代码，如 600519.SH ，支持 A 股、港股 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| code | String | 响应码， 000000 表示正常 |
| msg | String | 请求结果消息提示 |
| status | Boolean | 请求执行状态， true 表示成功 |
| data | Object | 返回内容对象 |
| ↳ date | String | 同业对比生成时间，格式： yyyy-MM-dd |
| ↳ content | String | 公司同业对比具体内容，Markdown 字符串 |

#### 参数说明补充

- 这些 Agent 接口的核心入参是 `securityCode`，不是自由文本 `query`。
### AI 云盘查询

**请求 URL**

- `https://open.gangtise.com/application/open-ai/drive/getList`

**请求方式**：`POST`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | 通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| from | 是 | Integer | 0 | 分页参数：请求开始位置（条数） |
| size | 是 | Integer | 20 | 分页参数：单页数量，最大值为50 |
| startTime | 否 | String | - | 开始时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全），此处时间为文件创建时间 |
| endTime | 否 | String | - | 结束时间，格式严格为 yyyy-MM-dd HH:mm:ss ，兼容 yyyy-MM-dd 类型传参（自动补全），此处时间为文件创建时间 |
| keyword | 否 | String | - | 搜索关键词 |
| fileTypeList | 否 | List<Integer> | - | 文件类型： 1-文档 2-图片 3-音视频 4-公众号文章 5-其他 |
| spaceTypeList | 否 | List<Integer> | - | 搜索范围： 1-我的云盘 2-租户云盘 |

#### 返回字段

| 参数名 | 类型 | 说明 |
|---|---|---|
| fileId | String | 云盘文件唯一标识 |
| title | String | 文件标题 |
| createTime | String | 文件创建时间（东八区），格式严格为yyyy-MM-dd HH:mm:ss |
| fileType | Integer | 文件类型 |
| url | String | 文件关联链接（云盘内的微信公众号文章、笔记等存在关联链接如 https://mp.weixin.qq.com/） |
| uploader | String | 文件所有者（如 "张三"） |
| spaceType | Integer | 搜索范围： 1-我的云盘 2-租户云盘 |
| size | Integer | 文件大小（单位：字节） |

### AI 云盘文件下载

**请求 URL**

- `https://open.gangtise.com/application/open-ai/drive/download/file`

**请求方式**：`GET`

#### 请求头

| 请求头 | 类型 | 说明 |
|---|---|---|
| Authorization | String | accessToken，通过 【accessToken接口】 获取 |

#### 请求参数

| 参数名 | 必选 | 类型 | 默认值 | 说明 |
|---|---|---|---|---|
| id | 是 | Long | - | 云盘⽂件唯⼀标识 |

#### 参数说明补充

- 官方示例 URL 使用 `fileId` 作为 query 参数。

---

## 6. 补充说明

- 上述接口均来自本仓库中的 `Gangtise API URL.md` 对应官方文档页。
- 某些接口在真实联调中会出现“标准 envelope”与“非 envelope 成功返回”并存的情况，例如 `AI 云盘查询`。
- 某些下载/资源接口会因数据源权限、白名单或资源不匹配而返回业务错误，如 `10011401`、`433007`、`410004`。
- 如果需要程序化调用，建议统一按认证、统一返回结构与错误码约定进行封装。