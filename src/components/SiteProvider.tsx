'use client';

import { createContext, ReactNode, useContext } from 'react';

const SiteContext = createContext<{
  siteName: string;
  announcement?: string;
  alwaysShowAnnouncement?: boolean;
}>(
  {
    // 默认值
    siteName: 'MoonTV',
    announcement:
      '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
    alwaysShowAnnouncement: false,
  }
);

export const useSite = () => useContext(SiteContext);

export function SiteProvider({
  children,
  siteName,
  announcement,
  alwaysShowAnnouncement,
}: {
  children: ReactNode;
  siteName: string;
  announcement?: string;
  alwaysShowAnnouncement?: boolean;
}) {
  return (
    <SiteContext.Provider
      value={{ siteName, announcement, alwaysShowAnnouncement }}
    >
      {children}
    </SiteContext.Provider>
  );
}
