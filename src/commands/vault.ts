import { Command, Option } from "commander"

import { collectList, datetimeArg } from "../core/args.js"
import { buildStockPoolStocksBody, buildWechatChatroomListBody, buildWechatMessageListBody } from "../core/commandBodies.js"
import { uploadDriveFile } from "../core/driveUpload.js"
import { flagFailedItems } from "../core/normalize.js"
import { emit, addDownloadCommand, assertConfirmed, field, value, required, list, numberList, format, output, from, size, startTime, endTime, query } from "./shared.js"

export const vault = new Command("vault").description("Vault APIs")
query(vault, "drive-list", {
  endpoint: "vault.drive.list",
  cache: { endpointKey: "vault.drive.list", idField: "fileId" },
  fields: [
    from(), size(), startTime(), endTime(), value("--keyword <text>", undefined, "keyword"),
    numberList("--file-type <number>", "File type", "fileTypeList"),
    numberList("--space-type <number>", "Space type", "spaceTypeList"),
    format(), output(),
  ],
})
addDownloadCommand(vault, { endpointKey: "vault.drive.download", name: "drive-download", idOption: "--file-id", idField: "fileId", fallbackPrefix: "file", titleListEndpoint: "vault.drive.list" })

// ── drive management ──
// All free. Folder IDs come from 'drive-folder-list' ('root' = a space's root); file IDs
// from 'drive-folder-list' or 'drive-list'. Names are never unique — same-name files and
// folders are allowed and told apart only by ID — so re-running an upload, a create or a
// copy makes a second one. The two deletes are irreversible and need --yes.
const driveSpaceOption = (help: string) => new Option("--space-type <n>", help).choices(["1", "2"]).default("1")
const spaceType = (help: string) => field(driveSpaceOption(help), (v) => ({ spaceType: Number(v) }))

query(vault, "drive-folder-list", {
  description: "List the direct subfolders and files of a drive folder (free)",
  endpoint: "vault.drive.folder-list",
  fields: [
    spaceType("Space: 1=my drive 2=tenant drive"),
    value("--parent-id <id>", "Folder ID in that space; omit (or 'root') for the space's root. A folder of the other space is rejected with 100003", "parentId"),
    format("json"), output(),
  ],
})

vault.command("drive-upload").description("Upload a file to the AI drive (free; max 100MB per file; trial accounts max 500MB/day)")
  .requiredOption("--file <path>", "File to upload")
  .addOption(driveSpaceOption("Target space: 1=my drive 2=tenant drive (shared with your whole tenant)"))
  .option("--folder-id <id>", "Target folder ID in that space; omit (or 'root') for the space's root")
  .option("--title <name>", "Name in the drive, max 200 characters; defaults to the local file name")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, (client) => uploadDriveFile(client, options.file, { spaceType: Number(options.spaceType), folderId: options.folderId, title: options.title })))

query(vault, "drive-create-folder", {
  description: "Create a drive folder (free). Same-name folders are allowed, so re-running creates a second one",
  endpoint: "vault.drive.create-folder",
  fields: [
    required("--name <name>", "Folder name, max 200 characters (230004 past that)", "folderName"),
    spaceType("Space: 1=my drive 2=tenant drive (shared with your whole tenant)"),
    value("--parent-id <id>", "Parent folder ID in that space; omit (or 'root') for the root", "parentId"),
    format("json"), output(),
  ],
})

query(vault, "drive-rename", {
  description: "Rename a drive file or folder (free)",
  endpoint: "vault.drive.rename",
  fields: [
    field(new Option("--type <type>", "What --id names").choices(["file", "folder"]).makeOptionMandatory(), (v) => ({ type: v })),
    required("--id <id>", "File or folder ID", "id"),
    required("--name <name>", "New name, max 200 characters", "name"),
    format("json"), output(),
  ],
})

vault.command("drive-move-file").description("Move drive files into a folder of the SAME space (free)")
  .requiredOption("--file-id <id>", "File ID (repeat or comma-separate)", collectList)
  .requiredOption("--target-folder-id <id>", "Destination folder ID, or 'root'. Files of the other space land in failList (空间不一致)")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, async (client) => {
    const data = await client.call("vault.drive.move-file", { fileIdList: options.fileId, targetFolderId: options.targetFolderId })
    flagFailedItems(data, "vault drive-move-file")
    return data
  }))

query(vault, "drive-move-folder", {
  description: "Move a drive folder under another folder of the SAME space (free)",
  endpoint: "vault.drive.move-folder",
  fields: [
    required("--folder-id <id>", "Folder ID to move", "folderId"),
    required("--target-parent-id <id>", "Destination parent folder ID, or 'root'. Not the folder itself, one of its subfolders, or the other space (230005)", "targetParentId"),
    format("json"), output(),
  ],
})

// Files only. The endpoint also takes copyType=folder, but that answers 000000 with a new
// folder ID while leaving the copy empty (probed 2026-09-24), so it is not offered here.
vault.command("drive-copy").description("Copy files to the OTHER space: my drive <-> tenant drive (free; same-space copies are rejected)")
  .requiredOption("--file-id <id>", "Source file ID (repeat or comma-separate)", collectList)
  .requiredOption("--target-folder-id <id>", "Destination folder ID in the other space, or 'root' for that space's root")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action((options) => emit(options, async (client) => {
    const data = await client.call("vault.drive.copy", { copyType: "file", fileIdList: options.fileId, targetFolderId: options.targetFolderId })
    flagFailedItems(data, "vault drive-copy")
    return data
  }))

vault.command("drive-delete-file").description("Delete drive files — irreversible (free)")
  .requiredOption("--file-id <id>", "File ID to delete (repeat or comma-separate)", collectList)
  .option("--yes", "Required: confirm the deletion")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action(async (options) => {
    assertConfirmed("vault.drive.delete-file", Boolean(options.yes), options.fileId.join("、"))
    await emit(options, async (client) => {
      const data = await client.call("vault.drive.delete-file", { fileIdList: options.fileId })
      flagFailedItems(data, "vault drive-delete-file")
      return data
    })
  })

vault.command("drive-delete-folder").description("Delete a drive folder AND every subfolder and file inside it — irreversible (free)")
  .requiredOption("--folder-id <id>", "Folder ID to delete")
  .option("--yes", "Required: confirm the deletion")
  .option("--format <format>", "Output format", "json").option("--output <path>")
  .action(async (options) => {
    assertConfirmed("vault.drive.delete-folder", Boolean(options.yes), options.folderId)
    await emit(options, (client) => client.call("vault.drive.delete-folder", { folderId: options.folderId }))
  })
query(vault, "record-list", {
  endpoint: "vault.record.list",
  cache: { endpointKey: "vault.record.list", idField: "recordId" },
  fields: [
    from(), size(), startTime(), endTime(), value("--keyword <text>", undefined, "keyword"),
    list("--category <name>", "Recording type: upload/link/mobile/gtNote/pc/share", "categoryList"),
    numberList("--space-type <number>", "Space type: 1=my records / 2=tenant records", "spaceTypeList"),
    format(), output(),
  ],
})
addDownloadCommand(vault, { endpointKey: "vault.record.download", name: "record-download", idOption: "--record-id", idField: "recordId", fallbackPrefix: "record", contentTypeDescription: "Content type: original/asr/summary", contentTypeChoices: ["original", "asr", "summary"], titleListEndpoint: "vault.record.list" })
query(vault, "my-conference-list", {
  endpoint: "vault.my-conference.list",
  cache: { endpointKey: "vault.my-conference.list", idField: "conferenceId" },
  fields: [
    from(), size(), startTime(), endTime(), value("--keyword <text>", undefined, "keyword"),
    list("--research-area <id>", "Research area ID: citicIndustry code (1008001xx) or gangtiseIndustry direction code (122000xxx: macro/strategy/fixed-income/quant/overseas). swIndustry (104xx0000) returns 0 here", "researchAreaList"),
    list("--security <code>", "Security code", "securityList"),
    list("--institution <id>", "Institution ID", "institutionList"),
    list("--category <name>", "Conference category: earningsCall/strategyMeeting/fundRoadshow/shareholdersMeeting/maMeeting/specialMeeting/companyAnalysis/industryAnalysis/other", "categoryList"),
    numberList("--source <number>", "Recording source: 1=企微会议助理 2=会议服务微信群 (repeat)", "sourceList"),
    format(), output(),
  ],
})
addDownloadCommand(vault, { endpointKey: "vault.my-conference.download", name: "my-conference-download", idOption: "--conference-id", idField: "conferenceId", fallbackPrefix: "conference", contentTypeDescription: "Content type: asr/summary", contentTypeChoices: ["asr", "summary"], titleListEndpoint: "vault.my-conference.list" })
vault.command("wechat-message-list")
  .option("--from <number>", "Starting offset", "0")
  .option("--size <number>", "Total rows to return; omit to fetch all")
  .option("--start-time <datetime>", "Start time", datetimeArg("--start-time"))
  .option("--end-time <datetime>", "End time", datetimeArg("--end-time"))
  .option("--keyword <text>")
  .option("--security <code>", "Security code (e.g. 000001.SZ)", collectList, [])
  .option("--wechat-group-id <id>", "WeChat group ID", collectList, [])
  .option("--industry <id>", "Industry ID -- citicIndustry codes (1008001xx) only; swIndustry codes and unknown values are rejected with 100005", collectList, [])
  .option("--category <name>", "Message type: text/image/documents/url", collectList, [])
  .option("--tag <name>", "Tag: roadShow/research/strategyMeeting/meetingSummary/industryComment/companyComment/earningsReview", collectList, [])
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => emit(options, (client) => client.call("vault.wechat-message.list", buildWechatMessageListBody(options))))
vault.command("wechat-chatroom-list")
  .option("--from <number>", "Starting offset", "0")
  .option("--size <number>", "Total rows to return; omit to fetch all")
  .option("--room-name <name>", "WeChat group name; repeat or comma-separate for multiple names", collectList, [])
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => emit(options, (client) => client.call("vault.wechat-chatroom.list", buildWechatChatroomListBody(options))))
query(vault, "stock-pool-list", { endpoint: "vault.stock-pool.list", fields: [format(), output()] })
vault.command("stock-pool-stocks")
  .option("--pool-id <id>", "Pool ID; repeat for multiple; omit (or 'all') for all pools", collectList)
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => emit(options, (client) => client.call("vault.stock-pool.stocks", buildStockPoolStocksBody(options))))

// ── stock-pool writes ──
// These five change the user's own watchlists; every other command in the CLI only reads.
// `addStock` / `deleteStock` / `deletePool` report per-item failures inside a 000000
// envelope, so each pipes its result through flagFailedItems (→ partial, exit 3).
query(vault, "stock-pool-create", {
  endpoint: "vault.stock-pool.create",
  fields: [
    required("--name <name>", "New pool name; max 10 characters (a CJK character counts as 1) and must differ from every existing pool name. A duplicate is rejected with 230006, an over-long name with 230007. Max 30 pools per account (230003)", "poolName"),
    format(), output(),
  ],
})
query(vault, "stock-pool-rename", {
  endpoint: "vault.stock-pool.rename",
  fields: [
    required("--pool-id <id>", "Pool ID from 'stock-pool-list'", "poolId"),
    required("--name <name>", "New pool name; same rules as stock-pool-create (max 10 characters, must differ from every existing pool name). Renaming a pool to its own current name succeeds", "poolName"),
    format(), output(),
  ],
})
vault.command("stock-pool-add-stock")
  .requiredOption("--pool-id <id>", "Target pool ID from 'stock-pool-list'")
  .requiredOption("--security <code>", "Security code, e.g. 600519.SH (repeat or comma-separate)", collectList)
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => emit(options, async (client) => {
  const data = await client.call("vault.stock-pool.add-stock", { poolId: options.poolId, securityCodeList: options.security })
  flagFailedItems(data, "vault stock-pool-add-stock")
  return data
}))
vault.command("stock-pool-remove-stock")
  .requiredOption("--pool-id <id>", "Target pool ID from 'stock-pool-list'")
  .requiredOption("--security <code>", "Security code, e.g. 600519.SH (repeat or comma-separate)", collectList)
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => emit(options, async (client) => {
  const data = await client.call("vault.stock-pool.remove-stock", { poolId: options.poolId, securityCodeList: options.security })
  flagFailedItems(data, "vault stock-pool-remove-stock")
  return data
}))
// --yes is required, not a convenience: deleting a pool also drops every watch relation
// inside it (a pool can hold up to 10000 securities) and nothing restores them. The other
// four writes are recoverable by re-running their opposite, so only this one asks.
vault.command("stock-pool-delete")
  .requiredOption("--pool-id <id>", "Pool ID to delete; repeat or comma-separate for multiple", collectList)
  .option("--yes", "Required: confirm the deletion")
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action(async (options) => {
  assertConfirmed("vault.stock-pool.delete", Boolean(options.yes), options.poolId.join("、"))
  await emit(options, async (client) => {
    const data = await client.call("vault.stock-pool.delete", { poolIdList: options.poolId })
    flagFailedItems(data, "vault stock-pool-delete")
    return data
  })
})
