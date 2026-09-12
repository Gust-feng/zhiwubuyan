import React from "react";
import symbolSvg from "../../../brand/symbol-color.svg?raw";
import { decorativeSvg } from "../icon-svg";

/**
 * 标志的墨色跟随文字颜色（深色界面上必须反白），蓝色方点是品牌固定色，
 * 因此只把源文件里的石墨黑换成 currentColor，其余保持不变。
 */
const themedSymbol = decorativeSvg(symbolSvg)
  .replace('width="512" height="512"', 'width="100%" height="100%"')
  .replace(/\saria-label="[^"]*"/, "")
  .replaceAll("#17191C", "currentColor");

/** 知无不言标志。颜色取自父级 color，尺寸由 size 决定。 */
export function BrandMark({ size = 24 }: { readonly size?: number }): React.ReactElement {
  return (
    <span
      className="ui-brand-mark"
      style={{ display: "inline-flex", flex: "0 0 auto", width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: themedSymbol }}
    />
  );
}
