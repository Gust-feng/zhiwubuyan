import { ProductError } from "./errors.ts";
import { asRecord, readBoolean, readInt64String } from "./json.ts";

export type Paging = {
  isEnd: boolean;
  nextOffset?: string;
  totals?: string;
};

export function readPaging(value: unknown): Paging | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const isEnd = readBoolean(record.IsEnd, true);
  const nextOffset = readInt64String(record.NextOffset);
  if (!isEnd && nextOffset === undefined) {
    throw new ProductError("PROTOCOL_ERROR", "分页游标缺失或无法保持整数精度。");
  }
  return {
    isEnd,
    nextOffset,
    totals: readInt64String(record.Totals),
  };
}

export function nextOffsetQuery(paging: Paging | undefined): number | undefined {
  if (!paging || paging.isEnd || paging.nextOffset === undefined) return undefined;
  if (!/^-?\d+$/.test(paging.nextOffset)) {
    throw new ProductError("PROTOCOL_ERROR", "分页游标不是整数。");
  }
  const parsed = Number(paging.nextOffset);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProductError("PROTOCOL_ERROR", "分页游标超出可回传范围。");
  }
  return parsed;
}
