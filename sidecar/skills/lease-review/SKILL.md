---
name: lease-review
title: Commercial lease review
description: Review a commercial lease for the tenant or landlord: term, rent and indexation, termination, transfer, repairs and the statutory rules of the jurisdiction.
triggers: [lease, mietvertrag, geschäftsraummiete, tenancy, nájomná zmluva, nájemní smlouva, contract de închiriere]
output: suggestions
---
1. Identify the side the lawyer represents and the jurisdiction (default: the document's governing law).
2. Check: parties and premises, term (fixed or open-ended, renewal), rent, service charges, indexation clause and index, deposit or guarantee, permitted use, repairs and maintenance split, alterations, subletting and transfer of the lease on a sale of the business, landlord's termination rights, tenant's break options, reinstatement on exit.
3. For Austrian leases, check whether the MRG applies fully, partly or not at all, and search_law for the rules on termination, rent limits and § 12a MRG (sale of the business). For other jurisdictions, search_law for the mandatory tenant protection rules before judging a clause.
4. Flag clauses that are void or unenforceable under mandatory law separately from those that are merely unfavourable.

Output: suggestion cards; first line of prose says which statute regime applies and why.
