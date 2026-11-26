/* Generated route registry for TanStack Router. Kept in Git so clean builds have a complete route tree. */
import { Route as rootRouteImport } from "./routes/__root";
import { Route as IndexRouteImport } from "./routes/index";
import { Route as LegacyHomeRouteImport } from "./routes/legacy-home";
import { Route as LibraryRouteImport } from "./routes/library";
import { Route as AuthedRouteImport } from "./routes/_authed";
import { Route as AuthedDashboardRouteImport } from "./routes/_authed/dashboard";
import { Route as AuthedSubscriptionRouteImport } from "./routes/_authed/subscription";
import { Route as AuthedAdminVideosRouteImport } from "./routes/_authed/admin/videos";
import { Route as AuthedAdminVideoLibraryRouteImport } from "./routes/_authed/admin/video-library";
import { Route as AuthedAdminOperationsRouteImport } from "./routes/_authed/admin/operations";
import { Route as AuthedAdminAffiliatesRouteImport } from "./routes/_authed/admin/affiliates";
import { Route as AboutRouteImport } from "./routes/about";
import { Route as AdminRouteImport } from "./routes/admin";
import { Route as AdminShopRouteImport } from "./routes/admin/shop";
import { Route as AdminDigitalProductsRouteImport } from "./routes/admin-digital-products";
import { Route as AdminImportRouteImport } from "./routes/admin.import";
import { Route as LegacyAdminRouteImport } from "./routes/admin.legacy";
import { Route as CommunityRouteImport } from "./routes/community";
import { Route as ContactRouteImport } from "./routes/contact";
import { Route as CookiesRouteImport } from "./routes/cookies";
import { Route as CopyrightRouteImport } from "./routes/copyright";
import { Route as CreatorsRouteImport } from "./routes/creators";
import { Route as MarketplaceRouteImport } from "./routes/marketplace";
import { Route as MessagesRouteImport } from "./routes/messages";
import { Route as NewsRouteImport } from "./routes/news";
import { Route as NewsArticleRouteImport } from "./routes/news/$slug";
import { Route as NewsSitemapRouteImport } from "./routes/news-sitemap[.]xml";
import { Route as GrowthCronRouteImport } from "./routes/api/agents/growth/cron";
import { Route as InternalVideoPreviewRouteImport } from "./routes/api/internal-video-preview/$assetId";
import { Route as InternalVideoDownloadRouteImport } from "./routes/api/internal-video-download/$assetId";
import { Route as ShopDigitalDownloadRouteImport } from "./routes/api/shop/digital-download/$productId";
import { Route as NotificationsRouteImport } from "./routes/notifications";
import { Route as PrivacyRouteImport } from "./routes/privacy";
import { Route as RefundsRouteImport } from "./routes/refunds";
import { Route as SellerTermsRouteImport } from "./routes/seller-terms";
import { Route as ShopRouteImport } from "./routes/shop";
import { Route as SocialRouteImport } from "./routes/social";
import { Route as StudioRouteImport } from "./routes/studio";
import { Route as TermsRouteImport } from "./routes/terms";

const IndexRoute = IndexRouteImport.update({ id: "/", path: "/", getParentRoute: () => rootRouteImport });
const LegacyHomeRoute = LegacyHomeRouteImport.update({ id: "/legacy-home", path: "/legacy-home", getParentRoute: () => rootRouteImport });
const LibraryRoute = LibraryRouteImport.update({ id: "/library", path: "/library", getParentRoute: () => rootRouteImport });
const AuthedRoute = AuthedRouteImport.update({ id: "/_authed", getParentRoute: () => rootRouteImport });
const AuthedDashboardRoute = AuthedDashboardRouteImport.update({ id: "/dashboard", path: "/dashboard", getParentRoute: () => AuthedRoute });
const AuthedSubscriptionRoute = AuthedSubscriptionRouteImport.update({ id: "/subscription", path: "/subscription", getParentRoute: () => AuthedRoute });
const AuthedAdminVideosRoute = AuthedAdminVideosRouteImport.update({ id: "/admin/videos", path: "/admin/videos", getParentRoute: () => AuthedRoute });
const AuthedAdminVideoLibraryRoute = AuthedAdminVideoLibraryRouteImport.update({ id: "/admin/video-library", path: "/admin/video-library", getParentRoute: () => AuthedRoute });
const AuthedAdminOperationsRoute = AuthedAdminOperationsRouteImport.update({ id: "/admin/operations", path: "/admin/operations", getParentRoute: () => AuthedRoute });
const AuthedAdminAffiliatesRoute = AuthedAdminAffiliatesRouteImport.update({ id: "/admin/affiliates", path: "/admin/affiliates", getParentRoute: () => AuthedRoute });
const AboutRoute = AboutRouteImport.update({ id: "/about", path: "/about", getParentRoute: () => rootRouteImport });
const AdminRoute = AdminRouteImport.update({ id: "/admin", path: "/admin", getParentRoute: () => rootRouteImport });
const AdminShopRoute = AdminShopRouteImport.update({ id: "/admin/shop", path: "/admin/shop", getParentRoute: () => rootRouteImport });
const AdminDigitalProductsRoute = AdminDigitalProductsRouteImport.update({ id: "/admin-digital-products", path: "/admin-digital-products", getParentRoute: () => rootRouteImport });
const AdminImportRoute = AdminImportRouteImport.update({ id: "/admin/import", path: "/admin/import", getParentRoute: () => rootRouteImport });
const LegacyAdminRoute = LegacyAdminRouteImport.update({ id: "/admin/legacy", path: "/admin/legacy", getParentRoute: () => rootRouteImport });
const CommunityRoute = CommunityRouteImport.update({ id: "/community", path: "/community", getParentRoute: () => rootRouteImport });
const ContactRoute = ContactRouteImport.update({ id: "/contact", path: "/contact", getParentRoute: () => rootRouteImport });
const CookiesRoute = CookiesRouteImport.update({ id: "/cookies", path: "/cookies", getParentRoute: () => rootRouteImport });
const CopyrightRoute = CopyrightRouteImport.update({ id: "/copyright", path: "/copyright", getParentRoute: () => rootRouteImport });
const CreatorsRoute = CreatorsRouteImport.update({ id: "/creators", path: "/creators", getParentRoute: () => rootRouteImport });
const MarketplaceRoute = MarketplaceRouteImport.update({ id: "/marketplace", path: "/marketplace", getParentRoute: () => rootRouteImport });
const MessagesRoute = MessagesRouteImport.update({ id: "/messages", path: "/messages", getParentRoute: () => rootRouteImport });
const NewsRoute = NewsRouteImport.update({ id: "/news", path: "/news", getParentRoute: () => rootRouteImport });
const NewsArticleRoute = NewsArticleRouteImport.update({ id: "/$slug", path: "/$slug", getParentRoute: () => NewsRoute });
const NewsSitemapRoute = NewsSitemapRouteImport.update({ id: "/news-sitemap.xml", path: "/news-sitemap.xml", getParentRoute: () => rootRouteImport });
const GrowthCronRoute = GrowthCronRouteImport.update({ id: "/api/agents/growth/cron", path: "/api/agents/growth/cron", getParentRoute: () => rootRouteImport });
const InternalVideoPreviewRoute = InternalVideoPreviewRouteImport.update({ id: "/api/internal-video-preview/$assetId", path: "/api/internal-video-preview/$assetId", getParentRoute: () => rootRouteImport });
const InternalVideoDownloadRoute = InternalVideoDownloadRouteImport.update({ id: "/api/internal-video-download/$assetId", path: "/api/internal-video-download/$assetId", getParentRoute: () => rootRouteImport });
const ShopDigitalDownloadRoute = ShopDigitalDownloadRouteImport.update({ id: "/api/shop/digital-download/$productId", path: "/api/shop/digital-download/$productId", getParentRoute: () => rootRouteImport });
const NotificationsRoute = NotificationsRouteImport.update({ id: "/notifications", path: "/notifications", getParentRoute: () => rootRouteImport });
const PrivacyRoute = PrivacyRouteImport.update({ id: "/privacy", path: "/privacy", getParentRoute: () => rootRouteImport });
const RefundsRoute = RefundsRouteImport.update({ id: "/refunds", path: "/refunds", getParentRoute: () => rootRouteImport });
const SellerTermsRoute = SellerTermsRouteImport.update({ id: "/seller-terms", path: "/seller-terms", getParentRoute: () => rootRouteImport });
const ShopRoute = ShopRouteImport.update({ id: "/shop", path: "/shop", getParentRoute: () => rootRouteImport });
const SocialRoute = SocialRouteImport.update({ id: "/social", path: "/social", getParentRoute: () => rootRouteImport });
const StudioRoute = StudioRouteImport.update({ id: "/studio", path: "/studio", getParentRoute: () => rootRouteImport });
const TermsRoute = TermsRouteImport.update({ id: "/terms", path: "/terms", getParentRoute: () => rootRouteImport });

const NewsRouteWithChildren = NewsRoute._addFileChildren({ NewsArticleRoute });
const AuthedRouteWithChildren = AuthedRoute._addFileChildren({
  AuthedDashboardRoute,
  AuthedSubscriptionRoute,
  AuthedAdminVideosRoute,
  AuthedAdminVideoLibraryRoute,
  AuthedAdminOperationsRoute,
  AuthedAdminAffiliatesRoute,
});
const rootRouteChildren = {
  IndexRoute,
  LegacyHomeRoute,
  LibraryRoute,
  AuthedRoute: AuthedRouteWithChildren,
  AboutRoute,
  AdminRoute,
  AdminShopRoute,
  AdminDigitalProductsRoute,
  AdminImportRoute,
  AdminVideoLibraryRoute,
  LegacyAdminRoute,
  CommunityRoute,
  ContactRoute,
  CookiesRoute,
  CopyrightRoute,
  CreatorsRoute,
  MarketplaceRoute,
  MessagesRoute,
  NewsRoute: NewsRouteWithChildren,
  NewsSitemapRoute,
  GrowthCronRoute,
  InternalVideoPreviewRoute,
  InternalVideoDownloadRoute,
  ShopDigitalDownloadRoute,
  NotificationsRoute,
  PrivacyRoute,
  RefundsRoute,
  SellerTermsRoute,
  ShopRoute,
  SocialRoute,
  StudioRoute,
  TermsRoute,
};
export const routeTree = rootRouteImport._addFileChildren(rootRouteChildren);
