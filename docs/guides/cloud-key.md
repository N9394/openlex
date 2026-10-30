# Get a secure cloud AI key

This guide is for lawyers who want OpenLex to use a strong AI model in the cloud without handing client work to a consumer chat service. You do it once, it takes about 30 minutes, and you need no technical knowledge, just a credit card and someone at the firm who may sign up for cloud services.

**Rather not do it yourself?** In OpenLex, go to **Settings → AI** and click **Set it up for me** to book a setup call. We go through these steps with you on screen. You keep the account and the key; we never see your key or your documents.

What you will have at the end:

- Claude (Anthropic's model) running in **your firm's own AWS account**, in **EU data centres only** (Frankfurt, with the EU's other regions as overflow).
- **Nothing kept** by the service after an answer (zero data retention) and **no logs** of your texts.
- **A spending limit** of €50 a month, with e-mails before you get there and an automatic stop at the limit.

Already use Mistral or IONOS? Skip to [I already have Mistral](#i-already-have-mistral) or [I already have IONOS](#i-already-have-ionos).

---

## The main path: Claude on AWS Bedrock (EU)

### Step 1: An AWS account

If your firm already has an AWS account, ask whoever manages it to give you access (or to do steps 2 to 7 with you). Otherwise:

1. Go to [aws.amazon.com](https://aws.amazon.com) and click **Create an AWS account**.
2. Use a firm e-mail address that more than one person can read (for example `it@yourfirm.eu`), not your personal one. This address receives the bills and the warnings.
3. Enter the firm's details and a credit card, confirm your phone number, and choose the **Basic support** plan (free).
4. Sign in to the **AWS console** with the new account.

Tip: switch on two-step sign-in for the account (top right: your account name → **Security credentials** → **Assign MFA device**). It protects the account like online banking.

### Step 2: Choose Frankfurt

At the top right of the AWS console there is a region menu. Choose **Europe (Frankfurt) eu-central-1**. Check it is still Frankfurt at every step below: settings and keys are per region.

### Step 3: The one-time form for Anthropic

Anthropic, the company behind Claude, asks every new AWS account once what it plans to use Claude for.

1. In the search bar at the top, type **Bedrock** and open **Amazon Bedrock**.
2. In the menu on the left, open **Model catalog** and pick **Claude Sonnet** (by Anthropic).
3. If AWS asks you to **submit use case details**, fill in the short form: firm name, website, "legal work: document review and drafting" as the use, and that the users are internal staff. Submit.

Approval is usually immediate, at most a few minutes. You only do this once per AWS account.

### Step 4: Make a Bedrock API key

1. Still in Amazon Bedrock (Frankfurt), open **API keys** in the menu on the left.
2. Choose **Generate long-term API key**.
3. Set an expiry. 90 days is a good balance; OpenLex reminds nobody automatically, so put the date in your calendar.
4. Click **Generate** and **copy the key** right away. AWS shows it only once. Do not e-mail it or save it in a document; you paste it into OpenLex in the next step.

### Step 5: Paste the key into OpenLex

1. In OpenLex, open **Settings → AI**.
2. Click **I brought my own key** and choose **AWS Bedrock (EU)**.
3. Paste the key and click **Save**. OpenLex keeps it in your computer's keychain (macOS Keychain, Windows Credential Manager), never in a file and never on our servers.
4. Click **Test**. You should see a short answer from Claude.

(In the terminal: `openlex use bedrock --region eu-central-1`, then `openlex key bedrock`, then `openlex test`.)

### Step 6: Switch on zero data retention

This tells AWS not to keep your requests after the answer.

**The easy way:** in **Settings → AI**, next to AWS Bedrock, click **Switch on zero retention**. OpenLex sends the setting to AWS and checks that it took effect. You see "Zero retention: on" when it worked.

**If OpenLex says your key may not change this setting:** the key needs the AWS permission `bedrock:PutAccountDataRetention`, which keys made for everyday use often lack. Ask whoever manages your firm's AWS account to run this once with an administrator's Bedrock key (OpenLex shows the same command with a copy button):

```bash
curl -X PUT https://bedrock.eu-central-1.amazonaws.com/data-retention \
  -H "Authorization: Bearer ADMIN_BEDROCK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"none"}'
```

Then click **Check again** in OpenLex. The setting applies to the whole AWS account in Frankfurt, so it is done once, not per key. Background: [AWS documentation on data retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html).

### Step 7: Make sure nothing is logged

Bedrock can write every request and answer into a log in your account. That is off unless someone switched it on, but check:

1. In Amazon Bedrock (Frankfurt), open **Settings** at the bottom of the menu on the left.
2. Under **Model invocation logging**, the switch must be **off**. If it is on, switch it off and click **Save settings**.

### Step 8: Set a spending limit of €50 a month

AWS bills by use. A normal month of a lawyer's questions costs a few euros; €50 is a safety net, not a target.

1. In the search bar, type **Budgets** and open **Billing and Cost Management → Budgets**.
2. Click **Create budget**, choose **Use a template**, then **Monthly cost budget**.
3. Name it `OpenLex AI`, enter **50** as the amount (AWS uses your account's billing currency; set it to euros under **Billing preferences** if you want the figures in euros), and enter the firm e-mail address.
4. Click **Create budget**. AWS now e-mails you when the month's costs pass 85 % and 100 %, and when they are forecast to pass 100 %.
5. Open the new budget and add an **alert at 80 %** of actual cost if you want an earlier warning.

**An automatic stop at 100 %** (recommended):

1. Open the budget, then **Actions → Create action** (or edit the alert at 100 % and **Attach actions**).
2. Choose **IAM policy** as the action type.
3. Choose a policy that denies Bedrock, for example a policy named `OpenLexStop` with this content (your AWS administrator can create it under **IAM → Policies → Create policy → JSON**):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{ "Effect": "Deny", "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream"], "Resource": "*" }]
   }
   ```

4. Attach it to the **IAM user** that belongs to your API key (AWS created it with the key; its name starts with `BedrockAPIKey`).
5. Let the action run **automatically** when the 100 % alert fires. AWS asks for a role that may apply the policy; let it create one.

At the start of the next month, remove the policy from the user again (or ask your administrator to) to switch the AI back on. AWS cost figures arrive a few hours late, so the limit is a backstop. OpenLex has its own limit too, counted as you work: set the **monthly limit for online AI** in OpenLex's settings.

You are done. OpenLex now uses Claude in the EU, under your firm's contract with AWS, with nothing kept and a firm limit on cost.

---

## I already have Mistral

Mistral is a French company with data centres in the EU.

1. Sign in at [console.mistral.ai](https://console.mistral.ai). API use needs a plan with billing set up (**Billing** in the menu).
2. Open **API keys** and click **Create new key**. Give it a name like `OpenLex`, and an expiry date if offered. Copy the key; it is shown only once.
3. In OpenLex: **Settings → AI → I brought my own key → Mistral (EU)**. Paste the key, **Save**, then **Test**.
4. Ask Mistral for **zero data retention** (in the console under your organisation's privacy settings, or through Mistral support). Until Mistral approves it, Mistral keeps what you send for 30 days. OpenLex shows the status in **Settings → AI**.
5. Set a spending limit in the Mistral console (**Billing → Limits**) and the monthly limit for online AI in OpenLex's settings.

## I already have IONOS

IONOS is a German company; the AI Model Hub runs in Germany.

1. Sign in to the **IONOS Data Center Designer** ([dcd.ionos.com](https://dcd.ionos.com)).
2. Open **Management → Token Manager** and click **Generate token**. Choose an expiry, then copy the token; it is shown only once.
3. In OpenLex: **Settings → AI → I brought my own key → IONOS AI Model Hub (Germany)**. Paste the token, **Save**, then **Test**.
4. Ask IONOS in writing how long it keeps requests to the AI Model Hub, and keep the answer with your data protection records.
5. Set the monthly limit for online AI in OpenLex's settings.

---

## Good to know

- **Who sees your texts?** The cloud service you chose, under your firm's contract with it. Not us: OpenLex talks to the service directly from your computer.
- **Privileged matters** can stay on the AI on your computer whatever you set up here. See [Client data rules](client-data-rules.md).
- **Lost or leaked key?** Delete it where you made it (AWS: Bedrock → API keys; Mistral: API keys; IONOS: Token Manager), make a new one and paste it into OpenLex.
- More options (Azure, Google, your own server): [Choose your AI](choose-your-ai.md).
