"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expandQuery = expandQuery;
exports.buildExpandedFTSQuery = buildExpandedFTSQuery;
exports.getRelatedConcepts = getRelatedConcepts;
const ENGLISH_SYNONYMS = {
    contract: ['agreement', 'covenant', 'deed', 'compact', 'pact'],
    agreement: ['contract', 'accord', 'arrangement', 'understanding'],
    termination: ['cancellation', 'rescission', 'dissolution', 'ending'],
    breach: ['violation', 'infringement', 'default', 'non-compliance'],
    liability: ['responsibility', 'obligation', 'accountability', 'duty'],
    damages: ['compensation', 'indemnity', 'reparation', 'restitution'],
    party: ['contracting party', 'signatory', 'principal'],
    lease: ['rental', 'tenancy', 'letting'],
    tenant: ['lessee', 'renter', 'occupant'],
    landlord: ['lessor', 'property owner', 'proprietor'],
    eviction: ['dispossession', 'removal', 'ejection'],
    rent: ['rental payment', 'lease payment'],
    company: ['corporation', 'enterprise', 'firm', 'business entity'],
    shareholder: ['stockholder', 'equity holder', 'investor'],
    director: ['board member', 'executive'],
    merger: ['amalgamation', 'consolidation', 'combination'],
    employee: ['worker', 'staff member', 'personnel'],
    employer: ['company', 'firm', 'organization'],
    dismissal: ['termination', 'discharge', 'firing', 'redundancy'],
    wages: ['salary', 'remuneration', 'compensation', 'pay'],
    lawsuit: ['litigation', 'legal action', 'proceeding', 'suit'],
    arbitration: ['mediation', 'dispute resolution', 'adjudication'],
    court: ['tribunal', 'judiciary', 'bench'],
    judgment: ['verdict', 'ruling', 'decision', 'decree'],
    appeal: ['review', 'challenge', 'recourse'],
    privacy: ['data protection', 'confidentiality', 'personal data'],
    consent: ['permission', 'authorization', 'approval'],
    processing: ['handling', 'use', 'treatment'],
};
const GERMAN_SYNONYMS = {
    Vertrag: ['Vereinbarung', 'Abkommen', 'Kontrakt', 'Übereinkunft'],
    Kündigung: ['Beendigung', 'Auflösung', 'Aufhebung', 'Vertragsende'],
    Kündigungsfrist: ['Frist', 'Kündigungstermin', 'Vorlaufzeit'],
    Haftung: ['Verantwortung', 'Schadenersatzpflicht', 'Gewährleistung'],
    Schadenersatz: ['Entschädigung', 'Kompensation', 'Wiedergutmachung'],
    Vertragspartei: ['Partei', 'Vertragspartner', 'Kontrahent'],
    Pflichtverletzung: ['Vertragsverletzung', 'Verstoß', 'Nichterfüllung'],
    Mietvertrag: ['Mietverhältnis', 'Bestandvertrag', 'Pachtvertrag'],
    Mieter: ['Bestandnehmer', 'Pächter', 'Wohnungsinhaber'],
    Vermieter: ['Bestandgeber', 'Hauseigentümer', 'Verpächter'],
    Miete: ['Mietzins', 'Bestandzins', 'Mietentgelt'],
    Räumung: ['Delogierung', 'Zwangsräumung', 'Auszug'],
    Kaution: ['Sicherheitsleistung', 'Mietkaution', 'Depot'],
    Arbeitnehmer: ['Dienstnehmer', 'Angestellter', 'Beschäftigter'],
    Arbeitgeber: ['Dienstgeber', 'Unternehmen', 'Betrieb'],
    Entlassung: ['Kündigung', 'Freistellung', 'Beendigung'],
    Gehalt: ['Lohn', 'Entgelt', 'Vergütung', 'Bezüge'],
    Arbeitsvertrag: ['Dienstvertrag', 'Anstellungsvertrag'],
    Abfertigung: ['Abfindung', 'Abgangsentschädigung'],
    Gesellschaft: ['Unternehmen', 'Firma', 'Betrieb'],
    Gesellschafter: ['Teilhaber', 'Anteilseigner', 'Partner'],
    Geschäftsführer: ['GF', 'Direktor', 'Vorstand'],
    GmbH: ['Gesellschaft mit beschränkter Haftung', 'Kapitalgesellschaft'],
    Datenschutz: ['Datenschutzrecht', 'DSGVO', 'Privatsphäre'],
    Einwilligung: ['Zustimmung', 'Genehmigung', 'Erlaubnis'],
    Verarbeitung: ['Datenverarbeitung', 'Verwendung', 'Nutzung'],
    Betroffener: ['Betroffene Person', 'Datensubjekt'],
    Klage: ['Rechtsstreit', 'Verfahren', 'Prozess'],
    Urteil: ['Entscheidung', 'Erkenntnis', 'Beschluss'],
    Berufung: ['Rechtsmittel', 'Beschwerde', 'Revision'],
    Gericht: ['Tribunal', 'Gerichtshof', 'Richter'],
};
const ENGLISH_TO_GERMAN = {
    employment: ['Arbeitsrecht', 'Beschäftigung', 'Anstellung', 'Arbeit', 'Dienstverhältnis'],
    termination: ['Kündigung', 'Beendigung', 'Auflösung', 'Dienstende'],
    dismissal: ['Entlassung', 'Kündigung', 'fristlose', 'Beendigung'],
    'notice period': ['Kündigungsfrist', 'Kündigungsfristen', 'Frist', 'Dienstzeit'],
    notice: ['Kündigung', 'Kündigungsfrist', 'Ankündigung'],
    employee: ['Arbeitnehmer', 'Angestellte', 'Dienstnehmer', 'Beschäftigter', 'Mitarbeiter'],
    employer: ['Arbeitgeber', 'Dienstgeber', 'Unternehmer', 'Betrieb'],
    salary: ['Gehalt', 'Entgelt', 'Lohn', 'Vergütung', 'Bezüge'],
    wages: ['Lohn', 'Entgelt', 'Gehalt', 'Arbeitsentgelt'],
    contract: ['Vertrag', 'Arbeitsvertrag', 'Dienstvertrag', 'Anstellungsvertrag'],
    severance: ['Abfertigung', 'Abfindung', 'Abgangsentschädigung'],
    probation: ['Probezeit', 'Probe'],
    overtime: ['Überstunden', 'Mehrarbeit', 'Überstundenarbeit'],
    vacation: ['Urlaub', 'Urlaubsanspruch', 'Erholungsurlaub'],
    holiday: ['Urlaub', 'Feiertag', 'Ruhetag'],
    'working hours': ['Arbeitszeit', 'Arbeitsstunden', 'Normalarbeitszeit'],
    'working time': ['Arbeitszeit', 'Dienstzeit'],
    'rest period': ['Ruhezeit', 'Ruhepause', 'Pause'],
    'break': ['Pause', 'Ruhepause', 'Unterbrechung'],
    'sick leave': ['Krankenstand', 'Krankheit', 'Arbeitsunfähigkeit'],
    illness: ['Krankheit', 'Erkrankung', 'Krankenstand'],
    'maternity leave': ['Mutterschutz', 'Karenz', 'Mutterschaftsurlaub'],
    'parental leave': ['Karenz', 'Elternkarenz', 'Elternzeit'],
    pregnancy: ['Schwangerschaft', 'Mutterschutz'],
    discrimination: ['Diskriminierung', 'Benachteiligung', 'Gleichbehandlung'],
    harassment: ['Belästigung', 'Mobbing'],
    'sexual harassment': ['sexuelle Belästigung', 'Belästigung'],
    'equal treatment': ['Gleichbehandlung', 'Gleichstellung'],
    'collective agreement': ['Kollektivvertrag', 'KV', 'Tarifvertrag'],
    'works council': ['Betriebsrat', 'Arbeitnehmervertretung'],
    union: ['Gewerkschaft', 'Arbeitnehmerorganisation'],
    'trade union': ['Gewerkschaft'],
    'non-compete': ['Konkurrenzklausel', 'Wettbewerbsverbot', 'Konkurrenzverbot'],
    'confidentiality': ['Verschwiegenheit', 'Geheimhaltung', 'Betriebsgeheimnis'],
    breach: ['Vertragsverletzung', 'Vertragsbruch', 'Pflichtverletzung', 'Verstoß'],
    liability: ['Haftung', 'Schadenersatz', 'Verantwortung', 'Ersatzpflicht'],
    damages: ['Schadenersatz', 'Schaden', 'Entschädigung', 'Schadensersatz'],
    warranty: ['Gewährleistung', 'Garantie', 'Mängelgewähr'],
    guarantee: ['Garantie', 'Gewährleistung', 'Bürgschaft'],
    consumer: ['Verbraucher', 'Konsument', 'Käufer'],
    obligation: ['Pflicht', 'Verpflichtung', 'Verbindlichkeit'],
    performance: ['Leistung', 'Erfüllung', 'Erbringung'],
    default: ['Verzug', 'Zahlungsverzug', 'Leistungsverzug'],
    'good faith': ['Treu und Glauben', 'gutgläubig', 'redlich'],
    fraud: ['Betrug', 'Täuschung', 'arglistig'],
    'force majeure': ['höhere Gewalt', 'Unmöglichkeit'],
    impossibility: ['Unmöglichkeit', 'Leistungsunmöglichkeit'],
    void: ['nichtig', 'unwirksam', 'ungültig'],
    voidable: ['anfechtbar', 'vernichtbar'],
    'unfair terms': ['unzulässige Klauseln', 'Vertragsbestimmungen'],
    'general terms': ['Allgemeine Geschäftsbedingungen', 'AGB'],
    'standard terms': ['Allgemeine Geschäftsbedingungen', 'AGB', 'Standardklauseln'],
    withdrawal: ['Rücktritt', 'Widerruf', 'Rücktrittserklärung'],
    'right of withdrawal': ['Rücktrittsrecht', 'Widerrufsrecht'],
    rescission: ['Rücktritt', 'Aufhebung', 'Wandlung'],
    refund: ['Rückerstattung', 'Rückzahlung', 'Erstattung'],
    payment: ['Zahlung', 'Bezahlung', 'Entgelt'],
    price: ['Preis', 'Kaufpreis', 'Entgelt'],
    delivery: ['Lieferung', 'Übergabe', 'Zustellung'],
    'consumer protection': ['Verbraucherschutz', 'Konsumentenschutz', 'KSchG'],
    'distance selling': ['Fernabsatz', 'Fernabsatzvertrag'],
    'doorstep selling': ['Haustürgeschäft', 'außerhalb Geschäftsräumen'],
    'online purchase': ['Onlinekauf', 'Internetkauf', 'E-Commerce'],
    'cooling off period': ['Widerrufsfrist', 'Rücktrittsfrist', 'Bedenkzeit'],
    'right to return': ['Rückgaberecht', 'Rücktrittsrecht', 'Widerrufsrecht'],
    defect: ['Mangel', 'Defekt', 'Fehler'],
    repair: ['Reparatur', 'Verbesserung', 'Nachbesserung'],
    replacement: ['Austausch', 'Ersatz', 'Umtausch'],
    'price reduction': ['Preisminderung', 'Preisnachlass'],
    property: ['Eigentum', 'Besitz', 'Immobilie', 'Grundstück'],
    ownership: ['Eigentum', 'Eigentumsrecht', 'Besitz'],
    lease: ['Miete', 'Mietvertrag', 'Pacht'],
    rent: ['Miete', 'Mietzins', 'Bestandzins'],
    tenant: ['Mieter', 'Bestandnehmer', 'Pächter'],
    landlord: ['Vermieter', 'Bestandgeber', 'Hauseigentümer'],
    eviction: ['Räumung', 'Delogierung', 'Zwangsräumung'],
    deposit: ['Kaution', 'Sicherheitsleistung', 'Mietkaution'],
    'security deposit': ['Kaution', 'Sicherheitsleistung'],
    'rental agreement': ['Mietvertrag', 'Mietverhältnis', 'Bestandvertrag'],
    'rent increase': ['Mieterhöhung', 'Mietzinserhöhung'],
    'rent control': ['Mietzinsbeschränkung', 'Richtwertmietzins'],
    'protected tenancy': ['Mieterschutz', 'Kündigungsschutz'],
    sublease: ['Untermiete', 'Untervermietung'],
    'common areas': ['Gemeinschaftsräume', 'Allgemeinflächen'],
    'building regulations': ['Bauordnung', 'Baurecht'],
    condominium: ['Wohnungseigentum', 'Eigentumswohnung'],
    'right of succession': ['Eintrittsrecht', 'Mietrechtsübergang'],
    divorce: ['Scheidung', 'Ehescheidung', 'Trennung'],
    custody: ['Obsorge', 'Sorgerecht', 'Pflege und Erziehung'],
    alimony: ['Unterhalt', 'Alimente', 'Unterhaltsanspruch'],
    'child support': ['Kindesunterhalt', 'Alimente', 'Unterhaltspflicht'],
    maintenance: ['Unterhalt', 'Alimente', 'Versorgungsausgleich'],
    marriage: ['Ehe', 'Eheschließung', 'Heirat'],
    'civil partnership': ['eingetragene Partnerschaft', 'Lebenspartnerschaft'],
    adoption: ['Adoption', 'Annahme an Kindes statt'],
    guardian: ['Vormund', 'Sachwalter', 'Obsorgeberechtigter'],
    inheritance: ['Erbschaft', 'Erbrecht', 'Erbe'],
    heir: ['Erbe', 'Erbin', 'Erbberechtigter'],
    will: ['Testament', 'letztwillige Verfügung'],
    'last will': ['Testament', 'Letzter Wille'],
    bequest: ['Vermächtnis', 'Legat'],
    'forced heirship': ['Pflichtteil', 'Noterbrecht'],
    estate: ['Nachlass', 'Erbschaft', 'Verlassenschaft'],
    company: ['Gesellschaft', 'Unternehmen', 'Firma', 'Betrieb'],
    corporation: ['Kapitalgesellschaft', 'AG', 'Aktiengesellschaft'],
    shareholder: ['Gesellschafter', 'Aktionär', 'Anteilseigner'],
    director: ['Geschäftsführer', 'Vorstand', 'Direktor'],
    'managing director': ['Geschäftsführer', 'GF'],
    'board of directors': ['Vorstand', 'Aufsichtsrat'],
    'supervisory board': ['Aufsichtsrat'],
    'limited liability': ['beschränkte Haftung', 'Haftungsbeschränkung'],
    'limited company': ['GmbH', 'Gesellschaft mit beschränkter Haftung'],
    'joint stock company': ['AG', 'Aktiengesellschaft'],
    partnership: ['Personengesellschaft', 'Partnerschaft', 'OG', 'KG'],
    'general partnership': ['OG', 'offene Gesellschaft'],
    'limited partnership': ['KG', 'Kommanditgesellschaft'],
    merger: ['Verschmelzung', 'Fusion', 'Zusammenschluss'],
    acquisition: ['Übernahme', 'Erwerb', 'Akquisition'],
    dividend: ['Dividende', 'Gewinnausschüttung'],
    'articles of association': ['Gesellschaftsvertrag', 'Satzung'],
    incorporation: ['Gründung', 'Eintragung'],
    'commercial register': ['Firmenbuch', 'Handelsregister'],
    insolvency: ['Insolvenz', 'Konkurs', 'Zahlungsunfähigkeit'],
    bankruptcy: ['Konkurs', 'Insolvenz', 'Bankrott'],
    liquidation: ['Liquidation', 'Auflösung', 'Abwicklung'],
    court: ['Gericht', 'Gerichtshof', 'Tribunal'],
    lawsuit: ['Klage', 'Prozess', 'Rechtsstreit', 'Verfahren'],
    judgment: ['Urteil', 'Entscheidung', 'Erkenntnis'],
    appeal: ['Berufung', 'Rechtsmittel', 'Beschwerde'],
    'supreme court': ['Oberster Gerichtshof', 'OGH', 'Höchstgericht'],
    plaintiff: ['Kläger', 'Antragsteller'],
    defendant: ['Beklagter', 'Antragsgegner'],
    evidence: ['Beweis', 'Beweismittel', 'Nachweis'],
    witness: ['Zeuge', 'Zeugin', 'Zeugenaussage'],
    'burden of proof': ['Beweislast', 'Nachweispflicht'],
    verdict: ['Urteil', 'Spruch', 'Entscheidung'],
    'legal costs': ['Prozesskosten', 'Gerichtskosten', 'Verfahrenskosten'],
    'statute of limitations': ['Verjährung', 'Verjährungsfrist'],
    limitation: ['Verjährung', 'Frist'],
    injunction: ['einstweilige Verfügung', 'Unterlassungsklage'],
    enforcement: ['Vollstreckung', 'Exekution', 'Durchsetzung'],
    arbitration: ['Schiedsverfahren', 'Schiedsgericht', 'Schlichtung'],
    mediation: ['Mediation', 'Vermittlung', 'Schlichtung'],
    settlement: ['Vergleich', 'Einigung', 'Ausgleich'],
    'out of court': ['außergerichtlich', 'gütlich'],
    privacy: ['Datenschutz', 'Privatsphäre', 'Persönlichkeitsrecht'],
    'data protection': ['Datenschutz', 'DSGVO', 'Datenschutzrecht'],
    'personal data': ['personenbezogene Daten', 'Personendaten'],
    consent: ['Einwilligung', 'Zustimmung', 'Genehmigung'],
    processing: ['Verarbeitung', 'Datenverarbeitung'],
    'data subject': ['Betroffener', 'betroffene Person'],
    'data controller': ['Verantwortlicher', 'Datenverantwortlicher'],
    'data processor': ['Auftragsverarbeiter'],
    'data breach': ['Datenschutzverletzung', 'Datenpanne'],
    'right to erasure': ['Löschungsrecht', 'Recht auf Vergessenwerden'],
    'right of access': ['Auskunftsrecht', 'Zugangsrecht'],
    law: ['Recht', 'Gesetz', 'Rechtsnorm'],
    rights: ['Rechte', 'Ansprüche'],
    legal: ['rechtlich', 'gesetzlich', 'juristisch'],
    illegal: ['rechtswidrig', 'illegal', 'ungesetzlich'],
    unlawful: ['rechtswidrig', 'widerrechtlich'],
    lawful: ['rechtmäßig', 'gesetzlich'],
    regulation: ['Verordnung', 'Regelung', 'Vorschrift'],
    statute: ['Gesetz', 'Satzung', 'Statut'],
    clause: ['Klausel', 'Bestimmung', 'Absatz'],
    provision: ['Bestimmung', 'Vorschrift', 'Regelung'],
    article: ['Artikel', 'Paragraph', 'Absatz'],
    section: ['Paragraph', 'Abschnitt', 'Bestimmung'],
    amendment: ['Änderung', 'Novelle', 'Ergänzung'],
    repeal: ['Aufhebung', 'Widerruf'],
    interpretation: ['Auslegung', 'Interpretation'],
    precedent: ['Präzedenzfall', 'Vorentscheidung'],
    'case law': ['Rechtsprechung', 'Judikatur'],
    doctrine: ['Lehre', 'Doktrin', 'Rechtslehre'],
    negligence: ['Fahrlässigkeit', 'Nachlässigkeit'],
    'gross negligence': ['grobe Fahrlässigkeit'],
    intent: ['Vorsatz', 'Absicht'],
    'wilful misconduct': ['vorsätzliches Fehlverhalten', 'Vorsatz'],
    penalty: ['Strafe', 'Geldstrafe', 'Buße'],
    fine: ['Geldstrafe', 'Bußgeld', 'Strafe'],
    deadline: ['Frist', 'Termin', 'Stichtag'],
    term: ['Frist', 'Laufzeit', 'Begriff'],
    period: ['Zeitraum', 'Frist', 'Periode'],
    expiry: ['Ablauf', 'Fristende', 'Erlöschen'],
    valid: ['gültig', 'wirksam', 'rechtswirksam'],
    invalid: ['ungültig', 'unwirksam', 'nichtig'],
    binding: ['bindend', 'verbindlich'],
    'non-binding': ['unverbindlich'],
    effective: ['wirksam', 'rechtswirksam', 'in Kraft'],
    'entry into force': ['Inkrafttreten', 'Wirksamwerden'],
    signature: ['Unterschrift', 'Signatur'],
    notarized: ['notariell', 'beglaubigt'],
    certified: ['beglaubigt', 'zertifiziert'],
    authentic: ['authentisch', 'echt', 'beglaubigt'],
    original: ['Original', 'Urschrift'],
    copy: ['Kopie', 'Abschrift', 'Ausfertigung'],
};
const ENGLISH_TO_SLOVAK = {
    employment: ['pracovný', 'práca', 'zamestnanec', 'zamestnanie'],
    termination: ['skončenie', 'výpoveď', 'ukončenie', 'rozviazanie'],
    dismissal: ['prepustenie', 'výpoveď', 'odvolanie'],
    'notice period': ['výpovedná lehota', 'výpovedná doba'],
    notice: ['výpoveď', 'oznámenie'],
    employee: ['zamestnanec', 'pracovník', 'zamestnanca'],
    employer: ['zamestnávateľ', 'zamestnávateľa'],
    salary: ['mzda', 'plat', 'odmena'],
    wages: ['mzda', 'odmena'],
    contract: ['zmluva', 'dohoda', 'kontrakt'],
    'employment contract': ['pracovná zmluva', 'pracovný pomer'],
    severance: ['odstupné', 'odchodné'],
    probation: ['skúšobná doba', 'skúšobná lehota'],
    overtime: ['nadčas', 'práca nadčas', 'nadčasová práca'],
    vacation: ['dovolenka', 'pracovné voľno'],
    holiday: ['sviatok', 'dovolenka'],
    'working hours': ['pracovný čas', 'pracovná doba'],
    'sick leave': ['práceneschopnosť', 'nemocenská', 'PN'],
    'maternity leave': ['materská dovolenka', 'materská'],
    'parental leave': ['rodičovská dovolenka', 'rodičovský príspevok'],
    discrimination: ['diskriminácia', 'nerovnaké zaobchádzanie'],
    breach: ['porušenie', 'nesplnenie', 'nedodržanie'],
    liability: ['zodpovednosť', 'ručenie', 'záruka'],
    damages: ['náhrada škody', 'škoda', 'odškodnenie'],
    warranty: ['záruka', 'záručná doba'],
    consumer: ['spotrebiteľ', 'zákazník'],
    obligation: ['povinnosť', 'záväzok'],
    performance: ['plnenie', 'výkon'],
    default: ['omeškanie', 'neplnenie'],
    property: ['majetok', 'nehnuteľnosť', 'vlastníctvo'],
    ownership: ['vlastníctvo', 'vlastnícke právo'],
    lease: ['nájom', 'prenájom'],
    rent: ['nájomné', 'nájom'],
    tenant: ['nájomca', 'nájomník'],
    landlord: ['prenajímateľ', 'vlastník'],
    eviction: ['vysťahovanie', 'výpoveď z nájmu'],
    divorce: ['rozvod', 'rozvedenie'],
    custody: ['opatrovníctvo', 'zverenie do starostlivosti'],
    alimony: ['výživné', 'alimenty'],
    'child support': ['výživné na dieťa', 'alimenty'],
    marriage: ['manželstvo', 'sobáš'],
    inheritance: ['dedičstvo', 'dedenie'],
    company: ['spoločnosť', 'firma', 'podnik', 'obchodná spoločnosť'],
    corporation: ['spoločnosť', 'akciová spoločnosť', 'korporácia'],
    business: ['podnikanie', 'obchod', 'podnik', 'firma'],
    shareholder: ['spoločník', 'akcionár', 'podielnik'],
    director: ['konateľ', 'riaditeľ', 'štatutár'],
    founder: ['zakladateľ', 'spoluzakladateľ'],
    bankruptcy: ['konkurz', 'bankrot', 'úpadok'],
    insolvency: ['platobná neschopnosť', 'insolvencia'],
    'set up': ['založenie', 'založiť', 'zriadenie', 'zriadiť', 'Obchodný zákonník'],
    'setting up': ['založenie', 'zakladanie', 'zriadenie', 'Obchodný zákonník'],
    setting: ['založenie', 'zakladanie', 'nastavenie'],
    setup: ['založenie', 'zriadenie', 'nastavenie', 'Obchodný zákonník'],
    establish: ['založiť', 'zriadiť', 'ustanoviť', 'Obchodný zákonník'],
    establishment: ['založenie', 'zriadenie', 'vznik', 'Obchodný zákonník'],
    formation: ['založenie', 'vznik', 'vytvorenie', 'Obchodný zákonník'],
    'company formation': ['založenie spoločnosti', 'založenie firmy', 'vznik spoločnosti', 'Obchodný zákonník', '§ 57'],
    incorporate: ['založiť', 'inkorporovať', 'zaregistrovať', 'Obchodný zákonník'],
    incorporation: ['založenie', 'inkorporácia', 'zápis', 'Obchodný zákonník'],
    registration: ['registrácia', 'zápis', 'zapísanie', 'obchodný register'],
    register: ['register', 'zaregistrovať', 'zapísať', 'obchodný register'],
    'commercial register': ['obchodný register', 'register firiem', 'OR'],
    'trade register': ['obchodný register', 'živnostenský register'],
    'commercial code': ['Obchodný zákonník', 'obchodného zákonníka', 'ObchZ'],
    'limited liability': ['s ručením obmedzeným', 'sro', 's.r.o.', 'Obchodný zákonník § 105'],
    'limited company': ['sro', 's.r.o.', 'spoločnosť s ručením obmedzeným', 'Obchodný zákonník'],
    capital: ['základné imanie', 'kapitál', 'vklad', 'Obchodný zákonník'],
    'share capital': ['základné imanie', 'akciový kapitál', 'Obchodný zákonník'],
    'articles of association': ['zakladateľská listina', 'spoločenská zmluva', 'stanovy', 'Obchodný zákonník § 57'],
    'memorandum of association': ['zakladateľská listina', 'spoločenská zmluva', 'Obchodný zákonník § 57'],
    requirements: ['požiadavky', 'podmienky', 'náležitosti'],
    procedure: ['postup', 'procedúra', 'konanie'],
    steps: ['kroky', 'postup', 'fázy'],
    'how to': ['ako', 'postup', 'návod'],
    documents: ['dokumenty', 'doklady', 'listiny', 'náležitosti'],
    'required documents': ['potrebné dokumenty', 'potrebné doklady', 'náležitosti', 'Obchodný zákonník § 57'],
    fees: ['poplatky', 'náklady', 'platby'],
    slovakia: ['slovensko', 'slovenský', 'SR', 'Slovenská republika'],
    slovak: ['slovenský', 'slovensko'],
    court: ['súd', 'súdny'],
    lawsuit: ['žaloba', 'súdny spor'],
    judgment: ['rozsudok', 'rozhodnutie'],
    appeal: ['odvolanie', 'sťažnosť'],
    plaintiff: ['žalobca', 'navrhovateľ'],
    defendant: ['žalovaný', 'odporca'],
    evidence: ['dôkaz', 'dokazovanie'],
    law: ['zákon', 'právo'],
    rights: ['práva', 'oprávnenia'],
    legal: ['právny', 'zákonný'],
    regulation: ['nariadenie', 'predpis', 'vyhláška'],
    clause: ['ustanovenie', 'klauzula', 'doložka'],
    deadline: ['lehota', 'termín'],
    valid: ['platný', 'účinný'],
    'data protection': ['ochrana údajov', 'ochrana osobných údajov'],
    privacy: ['súkromie', 'ochrana súkromia'],
    consent: ['súhlas', 'povolenie'],
};
const GERMAN_TO_SLOVAK = {
    Arbeitsvertrag: ['pracovná zmluva', 'pracovný pomer'],
    Arbeitnehmer: ['zamestnanec', 'pracovník'],
    Arbeitgeber: ['zamestnávateľ'],
    Kündigung: ['výpoveď', 'skončenie'],
    Kündigungsfrist: ['výpovedná lehota', 'výpovedná doba'],
    Gehalt: ['mzda', 'plat'],
    Lohn: ['mzda', 'odmena'],
    Urlaub: ['dovolenka'],
    Arbeitszeit: ['pracovný čas', 'pracovná doba'],
    Überstunden: ['nadčas', 'nadčasová práca'],
    Entlassung: ['prepustenie', 'výpoveď'],
    Probezeit: ['skúšobná doba'],
    Abfertigung: ['odstupné'],
    Vertrag: ['zmluva', 'dohoda'],
    Haftung: ['zodpovednosť', 'ručenie'],
    Schadenersatz: ['náhrada škody'],
    Gewährleistung: ['záruka'],
    Verbraucher: ['spotrebiteľ'],
    Miete: ['nájom', 'nájomné'],
    Mieter: ['nájomca'],
    Vermieter: ['prenajímateľ'],
    Eigentum: ['vlastníctvo'],
    Scheidung: ['rozvod'],
    Unterhalt: ['výživné'],
    Ehe: ['manželstvo'],
    Erbschaft: ['dedičstvo'],
    Gesellschaft: ['spoločnosť'],
    Geschäftsführer: ['konateľ'],
    Insolvenz: ['konkurz', 'insolvencia'],
    Gericht: ['súd'],
    Klage: ['žaloba'],
    Urteil: ['rozsudok'],
    Berufung: ['odvolanie'],
    Gesetz: ['zákon'],
    Recht: ['právo'],
    Frist: ['lehota'],
};
const SLOVAK_TO_GERMAN = {
    zamestnanec: ['Arbeitnehmer', 'Angestellter', 'Dienstnehmer', 'Beschäftigter'],
    zamestnávateľ: ['Arbeitgeber', 'Dienstgeber', 'Unternehmer'],
    'pracovná zmluva': ['Arbeitsvertrag', 'Dienstvertrag', 'Anstellungsvertrag'],
    'pracovný pomer': ['Arbeitsverhältnis', 'Dienstverhältnis', 'Beschäftigung'],
    výpoveď: ['Kündigung', 'Beendigung', 'Auflösung'],
    'výpovedná lehota': ['Kündigungsfrist', 'Kündigungstermin', 'Frist'],
    'výpovedná doba': ['Kündigungsfrist', 'Frist'],
    prepustenie: ['Entlassung', 'Kündigung', 'fristlose Kündigung'],
    mzda: ['Gehalt', 'Lohn', 'Entgelt', 'Vergütung'],
    plat: ['Gehalt', 'Lohn', 'Entgelt'],
    dovolenka: ['Urlaub', 'Urlaubsanspruch', 'Erholungsurlaub'],
    'pracovný čas': ['Arbeitszeit', 'Arbeitsstunden', 'Normalarbeitszeit'],
    'pracovná doba': ['Arbeitszeit', 'Dienstzeit'],
    nadčas: ['Überstunden', 'Mehrarbeit'],
    'skúšobná doba': ['Probezeit', 'Probearbeit'],
    odstupné: ['Abfertigung', 'Abfindung', 'Abgangsentschädigung'],
    práceneschopnosť: ['Krankenstand', 'Krankheit', 'Arbeitsunfähigkeit'],
    'materská dovolenka': ['Mutterschutz', 'Karenz', 'Mutterschaftsurlaub'],
    'rodičovská dovolenka': ['Karenz', 'Elternkarenz', 'Elternzeit'],
    diskriminácia: ['Diskriminierung', 'Benachteiligung', 'Gleichbehandlung'],
    kolektívna: ['Kollektivvertrag', 'Tarifvertrag'],
    zmluva: ['Vertrag', 'Vereinbarung', 'Abkommen', 'Kontrakt'],
    dohoda: ['Vereinbarung', 'Abkommen', 'Vertrag'],
    porušenie: ['Vertragsverletzung', 'Vertragsbruch', 'Pflichtverletzung'],
    zodpovednosť: ['Haftung', 'Verantwortung', 'Schadenersatzpflicht'],
    'náhrada škody': ['Schadenersatz', 'Entschädigung', 'Kompensation'],
    škoda: ['Schaden', 'Schadenersatz', 'Beschädigung'],
    záruka: ['Gewährleistung', 'Garantie', 'Mängelgewähr'],
    spotrebiteľ: ['Verbraucher', 'Konsument', 'Käufer'],
    povinnosť: ['Pflicht', 'Verpflichtung', 'Verbindlichkeit'],
    záväzok: ['Verpflichtung', 'Verbindlichkeit', 'Pflicht'],
    plnenie: ['Leistung', 'Erfüllung', 'Erbringung'],
    omeškanie: ['Verzug', 'Zahlungsverzug', 'Leistungsverzug'],
    neplatný: ['nichtig', 'unwirksam', 'ungültig'],
    platný: ['gültig', 'wirksam', 'rechtswirksam'],
    odstúpenie: ['Rücktritt', 'Widerruf', 'Rücktrittserklärung'],
    majetok: ['Eigentum', 'Besitz', 'Vermögen'],
    vlastníctvo: ['Eigentum', 'Eigentumsrecht', 'Besitz'],
    nehnuteľnosť: ['Immobilie', 'Liegenschaft', 'Grundstück'],
    nájom: ['Miete', 'Mietvertrag', 'Pacht'],
    prenájom: ['Miete', 'Vermietung', 'Verpachtung'],
    nájomné: ['Miete', 'Mietzins', 'Bestandzins'],
    nájomca: ['Mieter', 'Bestandnehmer', 'Pächter'],
    prenajímateľ: ['Vermieter', 'Bestandgeber', 'Verpächter'],
    vysťahovanie: ['Räumung', 'Delogierung', 'Zwangsräumung'],
    kaucia: ['Kaution', 'Sicherheitsleistung', 'Mietkaution'],
    rozvod: ['Scheidung', 'Ehescheidung', 'Trennung'],
    manželstvo: ['Ehe', 'Eheschließung', 'Heirat'],
    výživné: ['Unterhalt', 'Alimente', 'Unterhaltsanspruch'],
    alimenty: ['Unterhalt', 'Alimente', 'Kindesunterhalt'],
    opatrovníctvo: ['Obsorge', 'Sorgerecht', 'Pflege und Erziehung'],
    dedičstvo: ['Erbschaft', 'Erbrecht', 'Erbe'],
    dedenie: ['Erbschaft', 'Erbfolge', 'Vererbung'],
    testament: ['Testament', 'letztwillige Verfügung'],
    závet: ['Testament', 'Letzter Wille'],
    spoločnosť: ['Gesellschaft', 'Unternehmen', 'Firma'],
    podnik: ['Unternehmen', 'Betrieb', 'Firma'],
    spoločník: ['Gesellschafter', 'Teilhaber', 'Partner'],
    akcionár: ['Aktionär', 'Anteilseigner'],
    konateľ: ['Geschäftsführer', 'GF', 'Direktor'],
    riaditeľ: ['Direktor', 'Geschäftsführer', 'Vorstand'],
    konkurz: ['Konkurs', 'Insolvenz', 'Bankrott'],
    úpadok: ['Insolvenz', 'Konkurs', 'Zahlungsunfähigkeit'],
    likvidácia: ['Liquidation', 'Auflösung', 'Abwicklung'],
    súd: ['Gericht', 'Gerichtshof', 'Tribunal'],
    žaloba: ['Klage', 'Prozess', 'Rechtsstreit'],
    rozsudok: ['Urteil', 'Entscheidung', 'Erkenntnis'],
    rozhodnutie: ['Entscheidung', 'Urteil', 'Beschluss'],
    odvolanie: ['Berufung', 'Rechtsmittel', 'Beschwerde'],
    žalobca: ['Kläger', 'Antragsteller'],
    žalovaný: ['Beklagter', 'Antragsgegner'],
    dôkaz: ['Beweis', 'Beweismittel', 'Nachweis'],
    svedok: ['Zeuge', 'Zeugin'],
    premlčanie: ['Verjährung', 'Verjährungsfrist'],
    exekúcia: ['Exekution', 'Vollstreckung', 'Zwangsvollstreckung'],
    zákon: ['Gesetz', 'Rechtsnorm', 'Statute'],
    právo: ['Recht', 'Anspruch', 'Berechtigung'],
    právny: ['rechtlich', 'juristisch', 'gesetzlich'],
    predpis: ['Vorschrift', 'Verordnung', 'Regelung'],
    nariadenie: ['Verordnung', 'Regelung', 'Vorschrift'],
    vyhláška: ['Verordnung', 'Erlass', 'Bekanntmachung'],
    ustanovenie: ['Bestimmung', 'Vorschrift', 'Klausel'],
    lehota: ['Frist', 'Termin', 'Zeitraum'],
    termín: ['Frist', 'Termin', 'Stichtag'],
    účinný: ['wirksam', 'in Kraft', 'rechtswirksam'],
    podpis: ['Unterschrift', 'Signatur'],
    notár: ['Notar', 'notariell'],
    'ochrana údajov': ['Datenschutz', 'Datenschutzrecht', 'DSGVO'],
    'osobné údaje': ['personenbezogene Daten', 'Personendaten'],
    súhlas: ['Einwilligung', 'Zustimmung', 'Genehmigung'],
    súkromie: ['Privatsphäre', 'Datenschutz', 'Persönlichkeitsrecht'],
};
const SLOVAK_SYNONYMS = {
    zamestnanec: ['pracovník', 'zamestnanca', 'zamestnancom'],
    zamestnávateľ: ['zamestnávateľa', 'zamestnávateľom'],
    'pracovný pomer': ['pracovná zmluva', 'zamestnanie'],
    výpoveď: ['skončenie', 'ukončenie', 'rozviazanie'],
    mzda: ['plat', 'odmena', 'príjem'],
    zmluva: ['dohoda', 'kontrakt', 'zmluvný'],
    záväzok: ['povinnosť', 'záväzky'],
    škoda: ['ujma', 'náhrada škody'],
    nájom: ['prenájom', 'nájomné'],
    vlastníctvo: ['majetok', 'vlastnícke právo'],
    súd: ['súdny', 'tribunál'],
    zákon: ['právny predpis', 'legislatíva'],
    právo: ['oprávnenie', 'nárok'],
};
const ABBREVIATIONS = {
    ABGB: ['Allgemeines bürgerliches Gesetzbuch', 'Zivilrecht', 'Privatrecht'],
    MRG: ['Mietrechtsgesetz', 'Mietrecht', 'Mietgesetz', 'Wohnrecht'],
    WEG: ['Wohnungseigentumsgesetz', 'Wohnungseigentum', 'Eigentumswohnung'],
    KSchG: ['Konsumentenschutzgesetz', 'Verbraucherschutz', 'Konsumentenrecht'],
    UGB: ['Unternehmensgesetzbuch', 'Handelsrecht', 'Unternehmensrecht'],
    StGB: ['Strafgesetzbuch', 'Strafrecht'],
    DSG: ['Datenschutzgesetz', 'Datenschutz', 'Datenschutzrecht'],
    DSGVO: ['Datenschutz-Grundverordnung', 'GDPR', 'Datenschutzrecht'],
    AngG: ['Angestelltengesetz', 'Arbeitsrecht', 'Angestellte', 'Arbeitnehmer'],
    AVRAG: ['Arbeitsvertragsrechts-Anpassungsgesetz', 'Arbeitsvertragsrecht'],
    AZG: ['Arbeitszeitgesetz', 'Arbeitszeit', 'Arbeitsstunden', 'Überstunden'],
    ARG: ['Arbeitsruhegesetz', 'Ruhezeit', 'Ruhepause'],
    UrlG: ['Urlaubsgesetz', 'Urlaub', 'Urlaubsanspruch', 'Urlaubsentgelt'],
    ArbVG: ['Arbeitsverfassungsgesetz', 'Betriebsrat', 'Arbeitnehmervertretung'],
    MSchG: ['Mutterschutzgesetz', 'Mutterschutz', 'Schwangerschaft', 'Karenz'],
    VKG: ['Väter-Karenzgesetz', 'Vaterkarenz', 'Elternkarenz'],
    GlBG: ['Gleichbehandlungsgesetz', 'Gleichbehandlung', 'Diskriminierung', 'Gleichstellung'],
    DHG: ['Dienstnehmerhaftpflichtgesetz', 'Arbeitnehmerhaftung', 'Haftung'],
    AÜG: ['Arbeitskräfteüberlassungsgesetz', 'Leiharbeit', 'Arbeitnehmerüberlassung'],
    BPG: ['Betriebspensionsgesetz', 'Betriebspension', 'Pensionskasse'],
    BMSVG: ['Betriebliches Mitarbeiter- und Selbständigenvorsorgegesetz', 'Abfertigung neu', 'Mitarbeitervorsorge'],
    FAGG: ['Fern- und Auswärtsgeschäfte-Gesetz', 'Fernabsatz', 'Widerrufsrecht', 'Rücktrittsrecht'],
    ECG: ['E-Commerce-Gesetz', 'Onlinehandel', 'Internethandel'],
    PHG: ['Produkthaftungsgesetz', 'Produkthaftung', 'Schadenersatz'],
    VKrG: ['Verbraucherkreditgesetz', 'Verbraucherkredit', 'Konsumentenkredit'],
    ZaDiG: ['Zahlungsdienstegesetz', 'Zahlungsdienste', 'Überweisungen'],
    WGG: ['Wohnungsgemeinnützigkeitsgesetz', 'Genossenschaftswohnung', 'gemeinnützig'],
    BTVG: ['Bauträgervertragsgesetz', 'Bauträger', 'Immobilienprojekt'],
    GBG: ['Grundbuchsgesetz', 'Grundbuch', 'Liegenschaft'],
    GmbHG: ['GmbH-Gesetz', 'Gesellschaftsrecht', 'Gesellschaft', 'beschränkte Haftung'],
    AktG: ['Aktiengesetz', 'Aktienrecht', 'Aktiengesellschaft', 'AG'],
    GenG: ['Genossenschaftsgesetz', 'Genossenschaft', 'Kooperative'],
    UmwG: ['Umwandlungsgesetz', 'Umwandlung', 'Verschmelzung'],
    SpaltG: ['Spaltungsgesetz', 'Spaltung', 'Unternehmensspaltung'],
    FBG: ['Firmenbuchgesetz', 'Firmenbuch', 'Handelsregister'],
    ZPO: ['Zivilprozessordnung', 'Zivilprozess', 'Gerichtsverfahren'],
    EO: ['Exekutionsordnung', 'Exekution', 'Zwangsvollstreckung'],
    IO: ['Insolvenzordnung', 'Insolvenz', 'Konkurs', 'Sanierung'],
    AußStrG: ['Außerstreitgesetz', 'Außerstreitverfahren'],
    AVG: ['Allgemeines Verwaltungsverfahrensgesetz', 'Verwaltungsverfahren'],
    VwGVG: ['Verwaltungsgerichtsverfahrensgesetz', 'Verwaltungsgericht'],
    ASGG: ['Arbeits- und Sozialgerichtsgesetz', 'Arbeitsgericht', 'Sozialgericht'],
    UrhG: ['Urheberrechtsgesetz', 'Urheberrecht', 'Copyright'],
    MSchG_IP: ['Markenschutzgesetz', 'Markenrecht', 'Marke', 'Warenzeichen'],
    PatG: ['Patentgesetz', 'Patentrecht', 'Patent', 'Erfindung'],
    MuSchG: ['Musterschutzgesetz', 'Geschmacksmuster', 'Design'],
    UWG: ['Gesetz gegen unlauteren Wettbewerb', 'Wettbewerbsrecht', 'unlauterer Wettbewerb'],
    EheG: ['Ehegesetz', 'Ehe', 'Eheschließung', 'Scheidung'],
    EPG: ['Eingetragene Partnerschaft-Gesetz', 'eingetragene Partnerschaft', 'Lebenspartnerschaft'],
    OGH: ['Oberster Gerichtshof', 'Höchstgericht', 'Revision'],
    OLG: ['Oberlandesgericht', 'Berufung', 'Rechtsmittel'],
    LG: ['Landesgericht', 'Erstgericht'],
    BG: ['Bezirksgericht', 'Erstgericht'],
    VfGH: ['Verfassungsgerichtshof', 'Verfassungsrecht'],
    VwGH: ['Verwaltungsgerichtshof', 'Verwaltungsrecht'],
    BVwG: ['Bundesverwaltungsgericht', 'Verwaltungsverfahren'],
    ASG: ['Arbeits- und Sozialgericht', 'Arbeitsgericht'],
    BGB: ['Bürgerliches Gesetzbuch', 'Zivilgesetzbuch', 'deutsches Zivilrecht'],
    HGB: ['Handelsgesetzbuch', 'Handelsrecht', 'Kaufmannsrecht'],
    BetrVG: ['Betriebsverfassungsgesetz', 'Betriebsrat', 'Mitbestimmung'],
    TzBfG: ['Teilzeit- und Befristungsgesetz', 'Teilzeit', 'befristeter Arbeitsvertrag'],
    KSchG_DE: ['Kündigungsschutzgesetz', 'Kündigungsschutz', 'Kündigung'],
    GDPR: ['General Data Protection Regulation', 'DSGVO', 'privacy', 'Datenschutz'],
    EU: ['European Union', 'Europäische Union', 'Unionsrecht'],
    EuGH: ['Europäischer Gerichtshof', 'ECJ', 'Unionsrecht'],
    AEUV: ['Vertrag über die Arbeitsweise der Europäischen Union', 'EU-Vertrag'],
    EuGVVO: ['Europäische Gerichtsstands- und Vollstreckungsverordnung', 'Brüssel Ia'],
};
function expandQuery(query, options = {}) {
    const { language = 'auto', jurisdiction, maxSynonymsPerTerm = 2, includeAbbreviations = true, } = options;
    const detectedLang = language === 'auto' ? detectLanguage(query) : language;
    const isGermanJurisdiction = jurisdiction && ['AT', 'DE', 'CH'].includes(jurisdiction.toUpperCase());
    const isSlovakJurisdiction = jurisdiction && ['SK'].includes(jurisdiction.toUpperCase());
    let synonyms;
    if (detectedLang === 'de') {
        synonyms = { ...GERMAN_SYNONYMS, ...(includeAbbreviations ? ABBREVIATIONS : {}) };
    }
    else if (detectedLang === 'sk') {
        synonyms = { ...SLOVAK_SYNONYMS, ...(includeAbbreviations ? ABBREVIATIONS : {}) };
    }
    else {
        synonyms = { ...ENGLISH_SYNONYMS, ...(includeAbbreviations ? ABBREVIATIONS : {}) };
    }
    const tokens = query
        .split(/\s+/)
        .map((t) => t.replace(/[^\w\däöüßÄÖÜáéíóúýčďěňřšťžÁÉÍÓÚÝČĎĚŇŘŠŤŽľĽôÔäÄ]/g, ''))
        .filter((t) => t.length > 2);
    const synonymsUsed = {};
    const expandedTerms = [...tokens];
    for (const token of tokens) {
        const tokenLower = token.toLowerCase();
        for (const [term, syns] of Object.entries(synonyms)) {
            if (term.toLowerCase() === tokenLower) {
                const selected = syns.slice(0, maxSynonymsPerTerm);
                synonymsUsed[term] = selected;
                expandedTerms.push(...selected);
                break;
            }
        }
        for (const [term, syns] of Object.entries(synonyms)) {
            if (syns.some((s) => s.toLowerCase() === tokenLower) &&
                !synonymsUsed[term]) {
                synonymsUsed[tokenLower] = [term];
                expandedTerms.push(term);
                break;
            }
        }
        if (isGermanJurisdiction && detectedLang === 'en') {
            for (const [englishTerm, germanTerms] of Object.entries(ENGLISH_TO_GERMAN)) {
                if (englishTerm.toLowerCase().includes(tokenLower) ||
                    tokenLower.includes(englishTerm.toLowerCase())) {
                    const selected = germanTerms.slice(0, maxSynonymsPerTerm);
                    synonymsUsed[`${token}→DE`] = selected;
                    expandedTerms.push(...selected);
                }
            }
        }
        if (isSlovakJurisdiction && detectedLang === 'en') {
            for (const [englishTerm, slovakTerms] of Object.entries(ENGLISH_TO_SLOVAK)) {
                if (englishTerm.toLowerCase().includes(tokenLower) ||
                    tokenLower.includes(englishTerm.toLowerCase())) {
                    const selected = slovakTerms.slice(0, maxSynonymsPerTerm);
                    synonymsUsed[`${token}→SK`] = selected;
                    expandedTerms.push(...selected);
                }
            }
        }
        if (isSlovakJurisdiction && detectedLang === 'de') {
            for (const [germanTerm, slovakTerms] of Object.entries(GERMAN_TO_SLOVAK)) {
                if (germanTerm.toLowerCase() === tokenLower ||
                    tokenLower.includes(germanTerm.toLowerCase())) {
                    const selected = slovakTerms.slice(0, maxSynonymsPerTerm);
                    synonymsUsed[`${token}→SK`] = selected;
                    expandedTerms.push(...selected);
                }
            }
        }
        if (isGermanJurisdiction && detectedLang === 'sk') {
            for (const [slovakTerm, germanTerms] of Object.entries(SLOVAK_TO_GERMAN)) {
                if (slovakTerm.toLowerCase() === tokenLower ||
                    slovakTerm.toLowerCase().includes(tokenLower) ||
                    tokenLower.includes(slovakTerm.toLowerCase())) {
                    const selected = germanTerms.slice(0, maxSynonymsPerTerm);
                    synonymsUsed[`${token}→DE`] = selected;
                    expandedTerms.push(...selected);
                }
            }
        }
    }
    const queryLower = query.toLowerCase();
    if (isSlovakJurisdiction && detectedLang === 'en') {
        for (const [englishPhrase, slovakTerms] of Object.entries(ENGLISH_TO_SLOVAK)) {
            if (englishPhrase.includes(' ') && queryLower.includes(englishPhrase)) {
                const selected = slovakTerms.slice(0, maxSynonymsPerTerm + 1);
                synonymsUsed[`${englishPhrase}→SK`] = selected;
                expandedTerms.push(...selected);
            }
        }
    }
    if (isGermanJurisdiction && detectedLang === 'en') {
        for (const [englishPhrase, germanTerms] of Object.entries(ENGLISH_TO_GERMAN)) {
            if (englishPhrase.includes(' ') && queryLower.includes(englishPhrase)) {
                const selected = germanTerms.slice(0, maxSynonymsPerTerm + 1);
                synonymsUsed[`${englishPhrase}→DE`] = selected;
                expandedTerms.push(...selected);
            }
        }
    }
    const uniqueTerms = Array.from(new Set(expandedTerms.map((t) => t.toLowerCase())));
    return {
        original: query,
        expanded: uniqueTerms.join(' '),
        terms: uniqueTerms,
        synonymsUsed,
    };
}
function detectLanguage(text) {
    const slovakIndicators = [
        /[ľščťžýáíéúäôňďĽŠČŤŽÝÁÍÉÚÄÔŇĎ]/,
        /\b(alebo|ktorý|ktorá|pre|pri|ako|jeho|jej|ich|aby|keď)\b/i,
        /\b(zákon|súd|zmluva|právo|povinnosť|zamestnanec|zamestnávateľ)\b/i,
    ];
    const slovakScore = slovakIndicators.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
    if (slovakScore >= 2) {
        return 'sk';
    }
    const germanIndicators = [
        /[äöüß]/i,
        /\b(und|oder|der|die|das|mit|für|bei|nach|vom|zum|zur)\b/i,
        /\b(Vertrag|Gesetz|Recht|Gericht|Arbeit|Haftung|Miete|Schuld)\b/i,
        /(vertrag|gesetz|recht|gericht|arbeit|haftung|miete|schuld)$/i,
        /\b\w*(ae|oe|ue|ss)\w*\b/i,
        /\b(arbeits|kündigungs?|vertrags?|gesellschafts?|haftungs?|schadens?)/i,
    ];
    const germanScore = germanIndicators.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
    return germanScore >= 2 ? 'de' : 'en';
}
function buildExpandedFTSQuery(query) {
    const expanded = expandQuery(query);
    return expanded.terms.map((t) => `"${t}"`).join(' OR ');
}
function getRelatedConcepts(query) {
    const expanded = expandQuery(query);
    const concepts = [];
    for (const syns of Object.values(expanded.synonymsUsed)) {
        concepts.push(...syns);
    }
    return Array.from(new Set(concepts));
}
//# sourceMappingURL=queryExpansion.js.map