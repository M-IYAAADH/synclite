import React from 'react'
import type { DocsThemeConfig } from 'nextra-theme-docs'

const config: DocsThemeConfig = {
  logo: (
    <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>
      NexSync
    </span>
  ),
  project: {
    link: 'https://github.com/M-IYAAADH/NexSync',
  },
  docsRepositoryBase: 'https://github.com/M-IYAAADH/NexSync/tree/main/apps/docs',
  footer: {
    text: 'MIT License © NexSync',
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s – NexSync',
    }
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="NexSync — offline-first sync for any app" />
    </>
  ),
  sidebar: {
    titleComponent({ title }) {
      return <>{title}</>
    },
  },
  primaryHue: 210,
}

export default config
