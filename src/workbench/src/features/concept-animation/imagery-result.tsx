import { ImageryHistory } from './imagery-history'
import { ImageryPlayer } from './imagery-player'
import type { ImageryController } from './use-imagery'
import './imagery.css'

/** 成象结果态：播放器 + 历史列表。
 *  入口态由共享入口外壳承载（见 EntryViews）；这里只呈现生成结果，
 *  与深度研究、众声的结果态一样独占版面。 */
export function ImageryResult({ imagery, onReset }: {
  imagery: ImageryController
  onReset: () => void
}) {
  if (imagery.result === null) return null
  return (
    <div className="imagery-live">
      <ImageryPlayer record={imagery.result} onReset={onReset} />
      <aside className="imagery-live__history" aria-label="生成历史">
        <p className="imagery-history__heading">历史成象</p>
        <ImageryHistory
          items={imagery.history}
          activeId={imagery.result.id}
          onOpen={(id) => void imagery.open(id)}
          onRemove={(id) => void imagery.remove(id)}
        />
      </aside>
    </div>
  )
}
