// React 19의 @types/react는 전역 `JSX` 네임스페이스를 제공하지 않고
// `React.JSX`로 옮겼다. 컴포넌트에서 `JSX.Element` 표기를 계속 쓸 수 있도록
// 전역 JSX 네임스페이스를 React.JSX로 매핑하는 shim.
import type * as React from 'react'

declare global {
  namespace JSX {
    type Element = React.JSX.Element
    type ElementClass = React.JSX.ElementClass
    type ElementAttributesProperty = React.JSX.ElementAttributesProperty
    type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute
    type IntrinsicAttributes = React.JSX.IntrinsicAttributes
    type IntrinsicElements = React.JSX.IntrinsicElements
  }
}

export {}
