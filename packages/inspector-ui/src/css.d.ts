declare module "*.css" {}

declare module "*.css?inline" {
  const inlineCss: string;
  export default inlineCss;
}
