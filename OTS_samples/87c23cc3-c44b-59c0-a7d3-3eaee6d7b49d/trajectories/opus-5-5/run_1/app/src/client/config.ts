import { PAGE_CONFIG_ID, type PageConfig } from "../shared/page-config.js";

export const pageConfig: PageConfig = JSON.parse(document.getElementById(PAGE_CONFIG_ID)!.textContent!) as PageConfig;
