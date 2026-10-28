export interface BundleDocument {
    id: string;
    name: string;
    description: string;
    category: string;
    estimatedTime: string;
}
export interface BusinessBundle {
    id: string;
    name: string;
    tagline: string;
    description: string;
    icon: string;
    targetAudience: string;
    price: string;
    included: BundleDocument[];
    bonusFeatures: string[];
    popular?: boolean;
}
export declare const businessBundles: BusinessBundle[];
export declare function getBusinessBundle(id: string): BusinessBundle | undefined;
export declare function getRecommendedBundles(userType: string): BusinessBundle[];
//# sourceMappingURL=businessBundles.d.ts.map