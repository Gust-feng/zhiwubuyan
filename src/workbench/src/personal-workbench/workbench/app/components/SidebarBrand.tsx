import { BrandMark } from '@ui/components/brand-mark'

/** 侧栏只保留稳定的产品身份，不使用会与业务内容争夺注意力的装饰背景。 */
export function SidebarBrand() {
  return (
    <div className="ui-sidebar-brand">
      <span className="ui-sidebar-brand__mark" aria-hidden="true">
        <BrandMark size={20} />
      </span>
      <span className="ui-sidebar-brand__copy">
        <strong className="ui-sidebar-brand__name">知无不言</strong>
        <span className="ui-sidebar-brand__description">知识研究工作台</span>
      </span>
    </div>
  )
}
