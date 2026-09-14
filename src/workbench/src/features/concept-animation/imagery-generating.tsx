import './imagery.css'

/** 成象生成中：独占版面的等待界面。
 *
 *  生成要几十秒，如果只是输入卡上的按钮变个字，用户容易以为卡住了。
 *  这里换成一块专门的版面：动效表达「散乱的概念聚拢成型」（对应「概念成型，可见为象」），
 *  配一条不确定进度线，明确告诉用户已经在做事。
 *  文案分三段（读懂…／再合成…／这值得…），三段各自是一个整体，
 *  只能在段与段之间换行，段内不断开；版面够宽时就保持一行。 */
export function ImageryGenerating({ topic }: { topic: string }) {
  return (
    <div className="imagery-generating" role="status" aria-live="polite">
      <div className="imagery-generating__stage" aria-hidden>
        <span className="imagery-generating__tile" />
        <span className="imagery-generating__tile" />
        <span className="imagery-generating__tile" />
        <span className="imagery-generating__tile" />
      </div>
      <p className="imagery-generating__title">正在成象</p>
      <p className="imagery-generating__hint">
        <span className="imagery-generating__hint-part">读懂「{topic}」，</span>
        <span className="imagery-generating__hint-part">再合成一份分步讲解的动画，</span>
        <span className="imagery-generating__hint-part">这值得思考。</span>
      </p>
      <div className="imagery-generating__track" aria-hidden>
        <span />
      </div>
    </div>
  )
}
