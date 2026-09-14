import { Bookmark, Plus } from 'lucide-react';
import { useCoreFeed } from '@ui/personal-workbench/workbench/app/components/use-core-feed';
import './research-seeds.css';

/** 官方「问题路由」按账号画像推荐的问题，服务端已投影成同一种条目形状。 */
interface RecommendedSeed {
  readonly id: string;
  readonly title: string;
}

function readRecommendationItems(body: Record<string, unknown>): readonly RecommendedSeed[] {
  const raw = Array.isArray(body.items) ? body.items : [];
  return raw.flatMap((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (id === '' || title === '') return [];
    return [{ id, title }];
  });
}

/** 提问入口上方的种子内容：知乎官方按账号画像推荐的问题，点一条填进提问框。
 *  数据来自开放平台「问题路由」（creator 额度组，每日有限），读取状态由 useCoreFeed 统一处理。
 *  视觉保持克制：默认只露出少数几条，无额外动作——主角是下面的提问卡片。
 *  bare 为真时不画卡片外框（外框由共享入口外壳持有，切换时它不重画）。 */
export function ResearchSeeds({ onPick, limit = 4, bare = false }: { onPick: (title: string) => void; limit?: number; bare?: boolean }) {
  const feed = useCoreFeed('/api/user/recommendations', readRecommendationItems);
  const items = feed.items.slice(0, limit);
  const body = (
    <>
      <div className="dr-seeds__head">
        <Bookmark size={14} aria-hidden />
        <h2>为你推荐</h2>
        <span className="dr-seeds__meta">{updatedLabel(feed.fetchedAt)}</span>
      </div>
      {feed.status === 'loading' ? (
        <div className="dr-seeds__skeleton" aria-label="正在获取推荐">
          {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
        </div>
      ) : feed.status === 'error' || items.length === 0 ? (
        // 读不到就如实说：可能是未登录、额度耗尽或开放平台限流，也可能确实没有推荐。
        <p className="dr-seeds__notice">
          <span>{feed.status === 'error' ? feed.error ?? '推荐暂时不可用。' : '暂时没有推荐的问题。'}</span>
          {feed.status === 'error' && <button type="button" onClick={feed.retry}>重试</button>}
        </p>
      ) : (
        <ol className="dr-seeds__list">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="dr-seed" title={item.title} onClick={() => onPick(item.title)}>
                <span className="dr-seed__title">{item.title}</span>
                <Plus size={13} className="dr-seed__add" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
  if (bare) return body;
  return <section className="dr-seeds" aria-label="为你推荐">{body}</section>;
}

function updatedLabel(fetchedAt: string | undefined): string {
  if (fetchedAt === undefined) return '';
  const time = new Date(fetchedAt);
  if (Number.isNaN(time.getTime())) return '';
  return `更新于 ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
}
