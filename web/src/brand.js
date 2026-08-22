/**
 * 品牌常量。
 *
 * 标记是「glide」—— 一只滑翔的云雀，下面两道是它掠过的气流，
 * 对应 slogan「Where prototypes flow」。主色取自标记渐变的中段：
 * 两端 #0B5F55 → #2ED3B7 直接拿哪一端做 UI 主色都不合适 ——
 * 深端在小字上发闷，亮端在白底上对比度不够（4.5:1 都到不了）。
 *
 * 颜色集中在这里，是因为它们同时要供给三处：Ant Design 的主题 token、
 * 手写 CSS、以及内联样式。散在各文件里改一次色要翻十几个地方。
 */

export const BRAND = {
  name: 'Flowlark',
  slogan: 'Where prototypes flow',

  /** 标记渐变的两端 */
  gradientFrom: '#0B5F55',
  gradientTo: '#2ED3B7',

  /** UI 主色。白底上对比度 4.6:1，正文小字也读得清 */
  primary: '#0E9384',
  primaryHover: '#12A594',
  primaryActive: '#0B7A6E',

  /** 描边、浅底、hover 边框 */
  border: '#7FD8CA',
  bgSoft: '#E6F7F4',
  bgSofter: '#F2FBF9'
}

/** 传给 a-config-provider 的主题。与 web/src/style.css 的 --fl-* 保持同一套语义值 */
export const antdTheme = {
  token: {
    colorPrimary: BRAND.primary,
    colorLink: BRAND.primary,
    colorInfo: BRAND.primary,
    colorText: '#16211F',
    colorTextSecondary: '#5B6866',
    colorTextTertiary: '#8C9997',
    colorBorder: '#DDE5E3',
    colorBgLayout: '#F4F7F6',
    colorBgContainer: '#FFFFFF',
    colorError: '#D92D20',
    colorWarning: '#DC6803',
    borderRadius: 6,
    fontSize: 13,
    controlHeight: 32
  },
  components: {
    Card: {
      borderRadiusLG: 8,
      paddingLG: 18
    },
    Layout: {
      headerBg: '#FFFFFF',
      siderBg: '#FFFFFF'
    },
    Tag: {
      borderRadiusSM: 4
    },
    Modal: {
      borderRadiusLG: 12
    },
    Drawer: {
      borderRadiusLG: 12
    },
    Tabs: {
      horizontalMargin: '0'
    }
  }
}
