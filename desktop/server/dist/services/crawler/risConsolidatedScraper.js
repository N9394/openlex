"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUSTRIAN_LAWS = void 0;
exports.scrapeConsolidatedLaw = scrapeConsolidatedLaw;
exports.scrapeAndIngestLaw = scrapeAndIngestLaw;
exports.scrapeAndIngestMultipleLaws = scrapeAndIngestMultipleLaws;
const crypto = __importStar(require("crypto"));
exports.AUSTRIAN_LAWS = {
    ABGB: { gesetzesnummer: '10001622', fullName: 'Allgemeines bürgerliches Gesetzbuch' },
    ABGB_Eherecht: { gesetzesnummer: '10001622', fullName: 'ABGB - Eherecht (§§ 44-136)' },
    ABGB_Erbrecht: { gesetzesnummer: '10001622', fullName: 'ABGB - Erbrecht (§§ 531-824)' },
    EheG: { gesetzesnummer: '10001871', fullName: 'Ehegesetz' },
    EPG: { gesetzesnummer: '20007525', fullName: 'Eingetragene Partnerschaft-Gesetz' },
    StGB: { gesetzesnummer: '10002296', fullName: 'Strafgesetzbuch' },
    StPO: { gesetzesnummer: '10002326', fullName: 'Strafprozeßordnung 1975' },
    JGG: { gesetzesnummer: '10002825', fullName: 'Jugendgerichtsgesetz 1988' },
    SMG: { gesetzesnummer: '10011040', fullName: 'Suchtmittelgesetz' },
    FinStrG: { gesetzesnummer: '10003775', fullName: 'Finanzstrafgesetz' },
    VStG: { gesetzesnummer: '10005770', fullName: 'Verwaltungsstrafgesetz 1991' },
    VbVG: { gesetzesnummer: '20004425', fullName: 'Verbandsverantwortlichkeitsgesetz' },
    UGB: { gesetzesnummer: '10001702', fullName: 'Unternehmensgesetzbuch' },
    GmbHG: { gesetzesnummer: '10001720', fullName: 'GmbH-Gesetz' },
    AktG: { gesetzesnummer: '10001717', fullName: 'Aktiengesetz 1965' },
    GenG: { gesetzesnummer: '10001734', fullName: 'Genossenschaftsgesetz' },
    SE_G: { gesetzesnummer: '20003924', fullName: 'SE-Gesetz' },
    SpaltG: { gesetzesnummer: '10002946', fullName: 'Spaltungsgesetz' },
    UmwG: { gesetzesnummer: '10002939', fullName: 'Umwandlungsgesetz' },
    FBG: { gesetzesnummer: '10001687', fullName: 'Firmenbuchgesetz' },
    IO: { gesetzesnummer: '10001736', fullName: 'Insolvenzordnung' },
    URG: { gesetzesnummer: '10003371', fullName: 'Unternehmensreorganisationsgesetz' },
    EKEG: { gesetzesnummer: '20002924', fullName: 'Eigenkapitalersatz-Gesetz' },
    UWG: { gesetzesnummer: '10002665', fullName: 'Bundesgesetz gegen den unlauteren Wettbewerb' },
    KartG: { gesetzesnummer: '20004817', fullName: 'Kartellgesetz 2005' },
    ZPO: { gesetzesnummer: '10001699', fullName: 'Zivilprozessordnung' },
    EO: { gesetzesnummer: '10001700', fullName: 'Exekutionsordnung' },
    JN: { gesetzesnummer: '10001697', fullName: 'Jurisdiktionsnorm' },
    AußStrG: { gesetzesnummer: '20003047', fullName: 'Außerstreitgesetz' },
    GOG: { gesetzesnummer: '10001671', fullName: 'Gerichtsorganisationsgesetz' },
    ZustG: { gesetzesnummer: '10005522', fullName: 'Zustellgesetz' },
    ABGB_Arbeitsrecht: { gesetzesnummer: '10001622', fullName: 'ABGB Arbeitsrecht (§§ 1151-1164)' },
    AngG: { gesetzesnummer: '10008069', fullName: 'Angestelltengesetz' },
    AVRAG: { gesetzesnummer: '10008872', fullName: 'Arbeitsvertragsrechts-Anpassungsgesetz' },
    AZG: { gesetzesnummer: '10008238', fullName: 'Arbeitszeitgesetz' },
    ARG: { gesetzesnummer: '10008541', fullName: 'Arbeitsruhegesetz' },
    UrlG: { gesetzesnummer: '10008376', fullName: 'Urlaubsgesetz' },
    MSchG: { gesetzesnummer: '10008464', fullName: 'Mutterschutzgesetz 1979' },
    VKG: { gesetzesnummer: '10008300', fullName: 'Väter-Karenzgesetz' },
    IESG: { gesetzesnummer: '10008418', fullName: 'Insolvenz-Entgeltsicherungsgesetz' },
    ArbVG: { gesetzesnummer: '10008329', fullName: 'Arbeitsverfassungsgesetz' },
    ArbIG: { gesetzesnummer: '10008883', fullName: 'Arbeitsinspektionsgesetz 1993' },
    ASG: { gesetzesnummer: '10008781', fullName: 'Arbeits- und Sozialgerichtsgesetz' },
    GlBG: { gesetzesnummer: '20003395', fullName: 'Gleichbehandlungsgesetz' },
    LSD_BG: { gesetzesnummer: '20009555', fullName: 'Lohn- und Sozialdumping-Bekämpfungsgesetz' },
    ASchG: { gesetzesnummer: '10008910', fullName: 'ArbeitnehmerInnenschutzgesetz' },
    DHG: { gesetzesnummer: '10008203', fullName: 'Dienstnehmerhaftpflichtgesetz' },
    ASVG: { gesetzesnummer: '10008147', fullName: 'Allgemeines Sozialversicherungsgesetz' },
    GSVG: { gesetzesnummer: '10008425', fullName: 'Gewerbliches Sozialversicherungsgesetz' },
    BSVG: { gesetzesnummer: '10008471', fullName: 'Bauern-Sozialversicherungsgesetz' },
    BPGG: { gesetzesnummer: '10008859', fullName: 'Bundespflegegeldgesetz' },
    AlVG: { gesetzesnummer: '10008407', fullName: 'Arbeitslosenversicherungsgesetz 1977' },
    AMPFG: { gesetzesnummer: '10008905', fullName: 'Arbeitsmarktpolitik-Finanzierungsgesetz' },
    BAO: { gesetzesnummer: '10003940', fullName: 'Bundesabgabenordnung' },
    EStG: { gesetzesnummer: '10004570', fullName: 'Einkommensteuergesetz 1988' },
    KStG: { gesetzesnummer: '10004569', fullName: 'Körperschaftsteuergesetz 1988' },
    UStG: { gesetzesnummer: '10004873', fullName: 'Umsatzsteuergesetz 1994' },
    GebG: { gesetzesnummer: '10003882', fullName: 'Gebührengesetz 1957' },
    GrEStG: { gesetzesnummer: '10003868', fullName: 'Grunderwerbsteuergesetz 1987' },
    ErbStG: { gesetzesnummer: '10003850', fullName: 'Erbschafts- und Schenkungssteuergesetz 1955' },
    KommStG: { gesetzesnummer: '10003899', fullName: 'Kommunalsteuergesetz 1993' },
    GBG: { gesetzesnummer: '10001678', fullName: 'Allgemeines Grundbuchsgesetz 1955' },
    WEG: { gesetzesnummer: '20001921', fullName: 'Wohnungseigentumsgesetz 2002' },
    MRG: { gesetzesnummer: '10002531', fullName: 'Mietrechtsgesetz' },
    BTVG: { gesetzesnummer: '10003127', fullName: 'Bauträgervertragsgesetz' },
    HeizKG: { gesetzesnummer: '10002578', fullName: 'Heizkostenabrechnungsgesetz' },
    RichtWG: { gesetzesnummer: '10002645', fullName: 'Richtwertgesetz' },
    LPG: { gesetzesnummer: '10010157', fullName: 'Liegenschaftsteilungsgesetz' },
    KSchG: { gesetzesnummer: '10002462', fullName: 'Konsumentenschutzgesetz' },
    PHG: { gesetzesnummer: '10002746', fullName: 'Produkthaftungsgesetz' },
    FAGG: { gesetzesnummer: '20008917', fullName: 'Fern- und Auswärtsgeschäfte-Gesetz' },
    VKrG: { gesetzesnummer: '20006624', fullName: 'Verbraucherkreditgesetz' },
    HIKrG: { gesetzesnummer: '20009540', fullName: 'Hypothekar- und Immobilienkreditgesetz' },
    VRUG: { gesetzesnummer: '20009242', fullName: 'Verbraucherrechte-Richtlinie-Umsetzungsgesetz' },
    ZaDiG: { gesetzesnummer: '20006367', fullName: 'Zahlungsdienstegesetz' },
    DSG: { gesetzesnummer: '10001597', fullName: 'Datenschutzgesetz' },
    TKG: { gesetzesnummer: '20002849', fullName: 'Telekommunikationsgesetz 2003' },
    ECG: { gesetzesnummer: '20001703', fullName: 'E-Commerce-Gesetz' },
    SigG: { gesetzesnummer: '20001727', fullName: 'Signaturgesetz' },
    UrhG: { gesetzesnummer: '10001848', fullName: 'Urheberrechtsgesetz' },
    MSchG_IP: { gesetzesnummer: '10002180', fullName: 'Markenschutzgesetz 1970' },
    PatG: { gesetzesnummer: '10002155', fullName: 'Patentgesetz 1970' },
    GMG: { gesetzesnummer: '10002193', fullName: 'Gebrauchsmustergesetz' },
    DesignG: { gesetzesnummer: '20002799', fullName: 'Designgesetz' },
    HlSchG: { gesetzesnummer: '10002221', fullName: 'Halbleiterschutzgesetz' },
    AVG: { gesetzesnummer: '10005768', fullName: 'Allgemeines Verwaltungsverfahrensgesetz 1991' },
    VwGVG: { gesetzesnummer: '20008280', fullName: 'Verwaltungsgerichtsverfahrensgesetz' },
    VwGG: { gesetzesnummer: '10000051', fullName: 'Verwaltungsgerichtshofgesetz 1985' },
    VfGG: { gesetzesnummer: '10000245', fullName: 'Verfassungsgerichtshofgesetz 1953' },
    AHG: { gesetzesnummer: '10000056', fullName: 'Amtshaftungsgesetz' },
    StGG: { gesetzesnummer: '10000006', fullName: 'Staatsgrundgesetz' },
    EMRK: { gesetzesnummer: '10000308', fullName: 'Europäische Menschenrechtskonvention' },
    BWG: { gesetzesnummer: '10004827', fullName: 'Bankwesengesetz' },
    WAG: { gesetzesnummer: '20005787', fullName: 'Wertpapieraufsichtsgesetz 2007' },
    BörseG: { gesetzesnummer: '10002868', fullName: 'Börsegesetz 2018' },
    InvFG: { gesetzesnummer: '20007736', fullName: 'Investmentfondsgesetz 2011' },
    AIFMG: { gesetzesnummer: '20008411', fullName: 'Alternative Investmentfonds Manager-Gesetz' },
    VAG: { gesetzesnummer: '20009412', fullName: 'Versicherungsaufsichtsgesetz 2016' },
    VersVG: { gesetzesnummer: '10002739', fullName: 'Versicherungsvertragsgesetz' },
    DepotG: { gesetzesnummer: '10001743', fullName: 'Depotgesetz' },
    GewO: { gesetzesnummer: '10007517', fullName: 'Gewerbeordnung 1994' },
    GütbefG: { gesetzesnummer: '10007870', fullName: 'Güterbeförderungsgesetz 1995' },
    ÄrzteG: { gesetzesnummer: '10010500', fullName: 'Ärztegesetz 1998' },
    RAO: { gesetzesnummer: '10001927', fullName: 'Rechtsanwaltsordnung' },
    NO: { gesetzesnummer: '10001952', fullName: 'Notariatsordnung' },
    WTBG: { gesetzesnummer: '10003376', fullName: 'Wirtschaftstreuhandberufsgesetz 2017' },
    AWG: { gesetzesnummer: '20001782', fullName: 'Abfallwirtschaftsgesetz 2002' },
    WRG: { gesetzesnummer: '10010290', fullName: 'Wasserrechtsgesetz 1959' },
    UVP_G: { gesetzesnummer: '10010767', fullName: 'Umweltverträglichkeitsprüfungsgesetz 2000' },
    B_UHG: { gesetzesnummer: '20005011', fullName: 'Bundes-Umwelthaftungsgesetz' },
    ChemG: { gesetzesnummer: '10011102', fullName: 'Chemikaliengesetz 1996' },
    KindNamRÄG: { gesetzesnummer: '20008092', fullName: 'Kindschafts- und Namensrechts-Änderungsgesetz 2013' },
    UnterhG: { gesetzesnummer: '10002820', fullName: 'Unterhaltsvorschussgesetz 1985' },
    AußStrG_Familie: { gesetzesnummer: '20003047', fullName: 'Außerstreitgesetz (Familienrecht)' },
    ABGB_Kindschaft: { gesetzesnummer: '10001622', fullName: 'ABGB - Kindschaftsrecht (§§ 137-284)' },
};
function buildConsolidatedLawUrl(gesetzesnummer) {
    return `https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=${gesetzesnummer}`;
}
function extractTextFromHtml(html) {
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<\/?(p|div|br|li|tr|h[1-6])[^>]*>/gi, '\n');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&ouml;/g, 'ö');
    text = text.replace(/&auml;/g, 'ä');
    text = text.replace(/&uuml;/g, 'ü');
    text = text.replace(/&Ouml;/g, 'Ö');
    text = text.replace(/&Auml;/g, 'Ä');
    text = text.replace(/&Uuml;/g, 'Ü');
    text = text.replace(/&szlig;/g, 'ß');
    text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n/g, '\n\n');
    return text.trim();
}
function parseSections(html, lawCode) {
    const sections = [];
    const sectionPattern = /§\s*(\d+[a-z]?)\b\.?\s*([^§]*?)(?=§\s*\d|$)/gi;
    const textContent = extractTextFromHtml(html);
    let match;
    while ((match = sectionPattern.exec(textContent)) !== null) {
        const sectionNum = match[1];
        let content = match[2].trim();
        let title = '';
        const titleMatch = content.match(/^\s*\(([^)]+)\)/);
        if (titleMatch) {
            title = titleMatch[1];
            content = content.replace(titleMatch[0], '').trim();
        }
        else {
            const firstSentence = content.match(/^[^.!?]+[.!?]/);
            if (firstSentence && firstSentence[0].length < 200) {
                title = firstSentence[0].trim();
            }
        }
        if (content.length > 10) {
            sections.push({
                sectionNumber: `§ ${sectionNum}`,
                title: title || `Section ${sectionNum}`,
                content: content.substring(0, 5000),
                lawName: lawCode,
                jurisdiction: 'AT',
            });
        }
    }
    return sections;
}
async function scrapeConsolidatedLaw(lawCode) {
    const lawInfo = exports.AUSTRIAN_LAWS[lawCode];
    if (!lawInfo) {
        console.error(`[RIS Scraper] Unknown law code: ${lawCode}`);
        return null;
    }
    const url = buildConsolidatedLawUrl(lawInfo.gesetzesnummer);
    console.log(`[RIS Scraper] Fetching ${lawCode} from ${url}`);
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; LexVault/1.0; Educational)',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
            },
        });
        if (!response.ok) {
            console.error(`[RIS Scraper] HTTP error: ${response.status}`);
            return null;
        }
        const html = await response.text();
        console.log(`[RIS Scraper] Received ${html.length} bytes`);
        const sections = parseSections(html, lawCode);
        console.log(`[RIS Scraper] Parsed ${sections.length} sections from ${lawCode}`);
        return {
            lawCode,
            fullTitle: lawInfo.fullName,
            shortTitle: lawCode,
            gesetzesnummer: lawInfo.gesetzesnummer,
            sections,
            scrapedAt: new Date(),
            sourceUrl: url,
        };
    }
    catch (error) {
        console.error(`[RIS Scraper] Error scraping ${lawCode}:`, error);
        return null;
    }
}
async function scrapeAndIngestLaw(lawCode) {
    try {
        const law = await scrapeConsolidatedLaw(lawCode);
        if (!law || law.sections.length === 0) {
            return {
                success: false,
                sectionsFound: 0,
                chunksCreated: 0,
                error: `Failed to scrape ${lawCode} or no sections found`,
            };
        }
        const { ingestContent } = await Promise.resolve().then(() => __importStar(require('../rag/ingestion')));
        let chunksCreated = 0;
        for (const section of law.sections) {
            const content = `${section.sectionNumber} ${section.title}\n\n${section.content}`;
            try {
                const result = await ingestContent(content, {
                    sourceType: 'legislation',
                    sourceName: `${law.fullTitle} - ${section.sectionNumber}`,
                    sourceId: crypto.createHash('md5').update(`${lawCode}-${section.sectionNumber}`).digest('hex').slice(0, 16),
                    sourceUrl: law.sourceUrl,
                    jurisdiction: 'AT',
                    documentType: 'legislation',
                }, false);
                chunksCreated += result.chunksCreated;
            }
            catch (error) {
                console.error(`[RIS Scraper] Error ingesting ${section.sectionNumber}:`, error);
            }
        }
        console.log(`[RIS Scraper] Ingested ${law.fullTitle}: ${law.sections.length} sections, ${chunksCreated} chunks`);
        return {
            success: true,
            sectionsFound: law.sections.length,
            chunksCreated,
        };
    }
    catch (error) {
        return {
            success: false,
            sectionsFound: 0,
            chunksCreated: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
async function scrapeAndIngestMultipleLaws(lawCodes) {
    const results = {};
    let totalSections = 0;
    let totalChunks = 0;
    for (const lawCode of lawCodes) {
        console.log(`[RIS Scraper] Processing ${lawCode}...`);
        const result = await scrapeAndIngestLaw(lawCode);
        results[lawCode] = {
            success: result.success,
            sections: result.sectionsFound,
            chunks: result.chunksCreated,
            error: result.error,
        };
        if (result.success) {
            totalSections += result.sectionsFound;
            totalChunks += result.chunksCreated;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return { totalSections, totalChunks, results };
}
//# sourceMappingURL=risConsolidatedScraper.js.map