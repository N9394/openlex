"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDocument = parseDocument;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const mammoth_1 = __importDefault(require("mammoth"));
async function parseDocument(filepath) {
    const ext = path_1.default.extname(filepath).toLowerCase();
    if (ext === '.txt') {
        return parseTxtFile(filepath);
    }
    else if (ext === '.pdf') {
        return parsePdfFile(filepath);
    }
    else if (ext === '.docx' || ext === '.doc') {
        return parseDocxFile(filepath);
    }
    else {
        throw new Error(`Unsupported file format: ${ext}`);
    }
}
async function parseTxtFile(filepath) {
    try {
        const content = await promises_1.default.readFile(filepath, 'utf-8');
        return content;
    }
    catch (error) {
        console.error(`[PARSER] Failed to read TXT file: ${filepath}`, error);
        throw new Error('Failed to read text file');
    }
}
async function parsePdfFile(filepath) {
    try {
        console.log(`[PARSER] Parsing PDF file: ${filepath}`);
        const { PDFParse } = require('pdf-parse');
        const dataBuffer = await promises_1.default.readFile(filepath);
        const parser = new PDFParse({ data: dataBuffer });
        await parser.load();
        const result = await parser.getText();
        let text = '';
        if (result && result.pages) {
            text = result.pages.map((page) => page.text || '').join('\n');
        }
        if (!text || text.trim().length === 0) {
            console.warn(`[PARSER] No text extracted from PDF - may be scanned image: ${filepath}`);
            throw new Error('No text extracted from PDF - document may be a scanned image requiring OCR');
        }
        console.log(`[PARSER] Successfully extracted ${text.length} characters from PDF`);
        return text.trim();
    }
    catch (error) {
        console.error(`[PARSER] PDF parsing failed: ${filepath}`, error);
        throw new Error('Failed to parse PDF file');
    }
}
async function parseDocxFile(filepath) {
    try {
        console.log(`[PARSER] Parsing DOCX file: ${filepath}`);
        const result = await mammoth_1.default.extractRawText({ path: filepath });
        if (!result.value || result.value.trim().length === 0) {
            console.warn(`[PARSER] No text extracted from DOCX: ${filepath}`);
            throw new Error('No text extracted from DOCX file');
        }
        if (result.messages.length > 0) {
            console.log(`[PARSER] Mammoth warnings:`, result.messages);
        }
        console.log(`[PARSER] Successfully extracted ${result.value.length} characters from DOCX`);
        return result.value;
    }
    catch (error) {
        console.error(`[PARSER] DOCX parsing failed: ${filepath}`, error);
        throw new Error('Failed to parse DOCX file');
    }
}
function getMockLegalDocument() {
    return `
RESIDENTIAL LEASE AGREEMENT

This Residential Lease Agreement ("Agreement") is entered into on January 15, 2024 ("Effective Date")
by and between:

LANDLORD: ABC Property Management LLC
TENANT: John Doe

PREMISES: 123 Main Street, Apartment 4B, City, State, 12345

WHEREAS, Landlord is the owner of the premises described above and wishes to lease said premises to Tenant;
WHEREAS, Tenant desires to lease said premises from Landlord for residential purposes;

NOW, THEREFORE, in consideration of the mutual covenants and agreements herein contained, the parties
agree as follows:

1. TERM OF LEASE
The term of this Lease shall commence on February 1, 2024 and shall continue for a period of twelve (12)
months, ending on January 31, 2025. This Lease shall automatically renew for successive one-year terms
unless either party provides written notice of non-renewal at least sixty (60) days prior to the end of
the then-current term.

2. RENT
Tenant agrees to pay Landlord monthly rent of One Thousand Five Hundred Dollars ($1,500.00) due on the
first (1st) day of each calendar month. Rent payments received after the fifth (5th) day of the month
shall be subject to a late fee of Fifty Dollars ($50.00).

3. SECURITY DEPOSIT
Upon execution of this Agreement, Tenant shall deposit with Landlord the sum of One Thousand Five Hundred
Dollars ($1,500.00) as a security deposit. Said deposit shall be refundable within thirty (30) days after
termination of this Lease, less any deductions for damages beyond normal wear and tear, unpaid rent, or
cleaning expenses.

4. USE OF PREMISES
The premises shall be used exclusively for residential purposes by Tenant and Tenant's immediate family.
No pets are permitted on the premises without prior written consent of Landlord. No subletting or assignment
of this Lease is permitted without Landlord's express written consent.

5. UTILITIES
Tenant shall be responsible for payment of all utilities serving the premises, including but not limited to
electricity, gas, internet, and cable television. Landlord shall be responsible for water and sewer charges.

6. MAINTENANCE AND REPAIRS
Tenant shall maintain the premises in good, clean, and sanitary condition and shall be responsible for all
repairs and damages caused by Tenant's negligence or misuse. Landlord shall be responsible for major repairs
to structural elements, HVAC systems, and plumbing.

7. ENTRY AND INSPECTION
Landlord shall have the right to enter the premises for inspection, repairs, or showing to prospective tenants
or buyers, provided that Landlord gives Tenant at least twenty-four (24) hours prior written notice, except in
cases of emergency.

8. LIABILITY AND INDEMNIFICATION
Tenant agrees to indemnify and hold harmless Landlord from any claims, damages, losses, or expenses arising from
Tenant's use of the premises. Landlord shall not be liable for any injury to persons or property occurring on or
about the premises unless caused by Landlord's gross negligence or willful misconduct.

9. INSURANCE
Tenant is strongly encouraged to obtain renter's insurance to cover personal property and liability. Landlord's
insurance covers only the building structure and Landlord's property.

10. DEFAULT AND TERMINATION
In the event of default by Tenant in payment of rent or violation of any other term of this Agreement, Landlord
may terminate this Lease upon providing five (5) days written notice. Tenant may terminate this Lease prior to
expiration by providing sixty (60) days written notice and payment of an early termination fee equal to two (2)
months' rent.

11. DISPUTE RESOLUTION
Any disputes arising under this Agreement shall first be submitted to mediation. If mediation fails, disputes
shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association.
Each party hereby waives the right to a jury trial.

12. GENERAL PROVISIONS
This Agreement constitutes the entire agreement between the parties and supersedes all prior understandings.
This Agreement may be amended only by written instrument signed by both parties. If any provision of this Agreement
is found to be invalid or unenforceable, the remaining provisions shall continue in full force and effect. This
Agreement shall be governed by the laws of the State in which the premises are located.

IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first above written.

LANDLORD: _________________________     Date: ___________
          ABC Property Management LLC

TENANT: ___________________________     Date: ___________
        John Doe

---

NOTICE TO TENANT: This is a legally binding contract. Read it carefully before signing. You have the right to
seek legal counsel before entering into this Agreement. By signing below, you acknowledge that you have read,
understood, and agree to all terms and conditions set forth herein.
`.trim();
}
//# sourceMappingURL=docParser.js.map