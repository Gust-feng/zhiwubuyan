import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import type { ResearchViewModel, ResearchReportSectionView } from './research-view-model';

export function ResearchReport({ research, markdownUrl, onSelectSource }: {
  research: ResearchViewModel;
  markdownUrl: string;
  onSelectSource: (id: string) => void;
}) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyReport() {
    try {
      const response = await fetch(markdownUrl);
      if (!response.ok || (response.headers.get('content-type') ?? '').includes('json')) {
        setCopyStatus('failed');
        return;
      }
      await navigator.clipboard.writeText(await response.text());
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  function downloadReport() {
    const link = document.createElement('a');
    link.href = markdownUrl;
    link.download = `深度研究-${research.question.slice(0, 20)}.md`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  return (
    <article className="dr-report" aria-label="研究报告">
      <div className="dr-report__eyebrow"><span className="dr-kicker">RESEARCH REPORT</span><span><Check size={13} />研究已完成</span></div>
      <h1>{research.title}</h1>
      {research.reportMeta && (
        <div className="dr-report__flags">
          <span className="dr-report__flag" data-completeness={research.reportMeta.completeness}>
            {research.reportMeta.completeness === 'sufficient' ? '完整度：充分' : '完整度：部分'}
          </span>
          <span className="dr-report__flag">结束：{research.reportMeta.stopReason}</span>
        </div>
      )}
      <div className="dr-report__meta"><span>知乎深度研究</span><span>{research.sources.length} 个来源</span><span>{research.searchCount} 次检索</span><span>用时 {research.elapsedLabel}</span></div>
      {groupSections(research.report).map((group, index) => (
        <section className="dr-report__section" key={group.title}>
          <h2><span>{String(index + 1).padStart(2, '0')}</span>{group.title}</h2>
          {group.items.map((section) => (
            <p key={section.id}>{section.text}{section.sourceIds.map((id) => {
              const sourceIndex = research.sources.findIndex((source) => source.id === id);
              if (sourceIndex < 0) return null;
              return <button type="button" className="dr-citation" key={id} aria-label={`引用 ${sourceIndex + 1}：${research.sources[sourceIndex].title}`} onClick={() => onSelectSource(id)}>{sourceIndex + 1}</button>;
            })}</p>
          ))}
        </section>
      ))}
      {research.limitations.length > 0 && (
        <section className="dr-report__limitations" aria-label="研究限制">
          <h2>研究限制</h2>
          <ul>{research.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </section>
      )}
      <footer className="dr-report__actions">
        <button className="dr-button" type="button" onClick={() => void copyReport()}>{copyStatus === 'copied' ? <Check size={14} /> : <Copy size={14} />}{copyStatus === 'copied' ? '已复制' : '复制报告'}</button>
        <button className="dr-button" type="button" onClick={() => void downloadReport()}><Download size={14} />下载 Markdown</button>
        <span role="status">{copyStatus === 'failed' ? '报告读取失败，可重试或下载。' : copyStatus === 'copied' ? '已复制，包含来源编号。' : ''}</span>
      </footer>
    </article>
  );
}

/** 同一区块的多段合并到一个标题下，避免重复小节名。 */
function groupSections(sections: readonly ResearchReportSectionView[]): { title: string; items: readonly ResearchReportSectionView[] }[] {
  const groups: { title: string; items: ResearchReportSectionView[] }[] = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (last && last.title === section.title) last.items.push(section);
    else groups.push({ title: section.title, items: [section] });
  }
  return groups;
}
