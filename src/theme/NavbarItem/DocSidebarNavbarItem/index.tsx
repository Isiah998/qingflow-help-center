import React, {type ReactNode} from 'react';
import {
  useActiveDocContext,
  useLayoutDocsSidebar,
} from '@docusaurus/plugin-content-docs/client';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import DefaultNavbarItem from '@theme/NavbarItem/DefaultNavbarItem';
import DropdownNavbarItem from '@theme/NavbarItem/DropdownNavbarItem';
import type {Props} from '@theme/NavbarItem/DocSidebarNavbarItem';

const mobileProductSections = [
  {label: '新手指南', route: 'gettingStarted'},
  {label: '更新动态', route: 'releaseNotes'},
  {label: '帮助文档', route: 'introduction'},
  {
    label: '解决方案',
    route: 'solutions',
  },
  {
    label: '搭建技巧',
    route: 'building',
  },
  {label: '常见问题（FAQ）', route: 'faq'},
  {label: '视频中心', route: 'videos'},
  {label: '联系我们', route: 'contact'},
] as const;

export default function DocSidebarNavbarItem({
  sidebarId,
  label,
  docsPluginId,
  mobile,
  ...props
}: Props): ReactNode {
  const {activeDoc} = useActiveDocContext(docsPluginId);
  const {siteConfig} = useDocusaurusContext();
  const sidebarLink = useLayoutDocsSidebar(sidebarId, docsPluginId).link;
  const coreDocRoutes = siteConfig.customFields?.coreDocRoutes as Record<
    (typeof mobileProductSections)[number]['route'],
    string
  >;

  if (!sidebarLink) {
    throw new Error(
      `DocSidebarNavbarItem: Sidebar with ID "${sidebarId}" doesn't have anything to be linked to.`,
    );
  }

  if (mobile) {
    return (
      <DropdownNavbarItem
        {...props}
        mobile
        label={label ?? sidebarLink.label}
        items={mobileProductSections.map(({label: itemLabel, route}) => ({
          label: itemLabel,
          to: coreDocRoutes[route],
        }))}
      />
    );
  }

  return (
    <DefaultNavbarItem
      exact
      {...props}
      isActive={() => activeDoc?.sidebar === sidebarId}
      label={label ?? sidebarLink.label}
      to={sidebarLink.path}
    />
  );
}
