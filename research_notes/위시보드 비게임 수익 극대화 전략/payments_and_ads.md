# Payment and Advertising-Revenue Infrastructure for WISH BOARD (Korean 개인사업자, low-price digital goods, domestic + abroad)

Research date: 2026-11-22. Tags used below:
- **[official, fetched]**: read on the provider's or government's own page during this research.
- **[official, snippet]**: from the provider's own page, but seen only as a search-result summary (not opened in full).
- **[reported]**: blogs, news, vendor marketing, forums, competitor pages.

FX assumption for conversions (not sourced, for illustration only): USD 1 ≈ KRW 1,400.

---

## 1. Domestic payments (PG, 간편결제, 휴대폰결제, 정산, screening)

### Takeaway
For a new 개인사업자, the realistic domestic fee is about 3.4% (+10% VAT on the fee, so about 3.74%) on card and 간편결제, about 7% (+VAT) on 휴대폰 소액결제 for digital content, plus a one-time sign-up fee of about KRW 220,000 and annual fee of about KRW 110,000 (VAT extra) unless a PortOne bundle or promotion waives them. Settlement runs D+3 to D+5 for cards, but about D+30 for phone billing. New merchants start at the "일반" rate and get the 영세·중소 discount retroactively once the 국세청 list is applied.

### Cited Findings
- **Toss Payments price list [official, fetched]**: sign-up fee KRW 220,000 (one time), annual fee KRW 110,000. Cards (credit and check) 3.4% "일반". 계좌이체 2.0% (minimum KRW 200 per transaction). 가상계좌 KRW 400 per transaction. 휴대폰결제 3.5% for physical goods, **7.0% for digital content**, 8.0% for app-only. 간편결제 3.4%, "some 간편결제 carry extra fees per each provider's policy". **All fees exclude 10% VAT.** — [Toss Payments 수수료](https://www.tosspayments.com/about/fee)
- **Toss settlement and small-merchant rates [official, fetched]**: Toss average settlement "within 5 days" against an industry average of 15 days. Overseas payments via PayPal settle weekly plus 4 business days. New businesses start at the "일반" grade. 영세·중소 rates are applied each half-year from the 국세청 list, with the difference refunded. — [Toss Payments 수수료](https://www.tosspayments.com/about/fee)
- **Industry-wide new-merchant ranges [reported, PortOne blog dated 2025-12-04]**: card 3.2–3.5% (settles D+4~5), 계좌이체 1.8–2% (D+3~5), 가상계좌 KRW 300–400 per transaction (D+1), **휴대폰결제 about 6–9% (D+30)**, 간편결제 3.2–3.5%. NHN KCP and 나이스정보통신 are recommended for solo founders: annual fee waived, 3.2% card. Toss is listed with a KRW 110,000 annual fee and 3.4%. The average PG sign-up fee is about KRW 220,000, waived when signing up through a PortOne package. 다날 and KG파이낸셜 are noted as strong for phone billing for digital content (webtoons, music, games). — [PortOne 2026 국내 PG사 비교](https://blog.portone.io/opi_pg-comparison2026/)
- **NHN KCP via 고도몰 [reported]**: card 1.8%–3.4%, 계좌이체 1.8%, sign-up fee waiver as a promotion. — summarized from [PortOne/고도몰 search results](https://www.godo.co.kr/main/payments)
- **Market structure [reported]**: 154 registered PGs as of April 2024 (FSS basis). The top four (Toss Payments, KG이니시스, 나이스페이먼츠, NHN KCP) hold about 65–70% of the market. — [PortOne PG 비교](https://blog.portone.io/pgcompare/)
- **간편결제 fee disclosure [official, snippet; FSC press release, Jan 2026]**: 17 companies self-disclosed card and prepaid payment fee rates for Aug–Oct 2025. Weighted average **card 1.97%, prepaid 1.76%**, down 0.06%p and 0.09%p. The FSS found that some e-money businesses charge flat rates regardless of merchant size, or even charge small merchants more. Per-company rates are published at korfin.kr (자료실 → 결제수수료 공시). — [금융위원회 보도자료](https://fsc.go.kr/no010101/86029)
  - Note: these are the rates 간편결제 companies charge merchants directly. When 카카오페이, 네이버페이 or 토스페이 is used through a PG, Toss's page lists 3.4% plus a possible extra fee from the provider.
- **2023 first disclosure [reported, Asiae 2023-03]**: 간편결제 fees for merchants under KRW 300M revenue were in some cases about 3× the card-company preferential rate. This is old. — [아시아경제](https://view.asiae.co.kr/article/2023033023401676358)
- **Screening for risky categories [reported, PortOne blog]**: PGs screen each business independently and treat some categories as 유의/제한 업종. **Per-transaction instant payment structures pass more often than point/coin top-up structures.** If one PG rejects you, fix the product structure or terms and apply to another. — [PortOne 고위험 업종](https://blog.portone.io/opi-pg-guide_fortune/); [PortOne high-risk](https://blog.portone.io/opi_high-risk-industry/)
- **Card-company screening [reported, Toss blog]**: all 8 card companies screen each merchant under their own policies. Re-screening usually happens when basic items are missing. — [Toss Payments 카드사 심사 체크리스트](https://www.tosspayments.com/blog/articles/53711?from=more-article)
- **Billing (정기결제) [reported]**: registering a non-face-to-face billing key requires identity verification. Some PGs issue billing keys without it, but card-theft losses then fall on the merchant. — [모비인사이드 빌링 가이드](https://brunch.co.kr/@mobiinside/7372)

### Inferences
- **Per-sale take, Toss card or 간편결제, KRW 5,000 item**: 3.4% = KRW 170, plus 10% VAT on the fee = KRW 187. The service keeps about 96.3% before its own 10% output VAT. With output VAT (KRW 5,000 VAT-inclusive means KRW 455 VAT): about KRW 4,358, or 87% of the sticker price. A 일반과세자 can credit the KRW 17 VAT on the PG fee as input tax.
- **Phone billing for the same KRW 5,000 item**: 7% + VAT = KRW 385, and the money arrives about a month later. It is a poor default for a KRW 3,000–10,000 product. Offer it only if conversion data shows it is needed (teen buyers without cards).
- **Fixed costs**: KRW 220,000 + KRW 110,000/year (VAT extra). The annual fee alone equals the 3.4% fee on about KRW 3.2M of sales, and sign-up plus the first year (KRW 330,000) equals the fee on about KRW 9.7M. At very low volume these fixed costs exceed the percentage fees. KCP or 나이스정보통신 through PortOne (sign-up and annual fees waived, 3.2%) look cheaper for year one. Confirm by quote.
- A one-time "24h billboard" purchase is a simple per-transaction digital good. It should screen more easily than a coin/point top-up wallet. If WISH BOARD sells coins first and spends them on billboards, expect stricter screening.

### Gaps
- I could not open per-PG official pricing for KG이니시스, NHN KCP or 나이스페이 directly. The numbers above are PortOne's comparison or reseller pages. Get quotes.
- Exact 2025–2026 merchant rates for 카카오페이, 네이버페이 and 토스페이 by merchant tier were not retrieved. They are on korfin.kr.
- PortOne's own platform fee (the free tier versus paid plans) was not confirmed.
- Phone-billing screening for "digital content" (휴대폰 소액결제 콘텐츠 심사) and its limits for minors were not found.

---

## 2. International payments for a Korean seller (MoR and processors)

### Takeaway
**Stripe (including Stripe Managed Payments) is not available to Korea-based businesses, and Lemon Squeezy is closed to new sign-ups** (it shuts down 2027-03-31). Korea-eligible options with official confirmation are **Paddle** (MoR, 5% + 50¢, bespoke pricing under $10), **Polar** (MoR, Starter 5% + 50¢ + 1.5% for non-US cards, payouts to KR via Stripe Connect Express), **Dodo Payments** (MoR, 4% + 40¢ + 1.5% international), **Gumroad** (10% + 50¢ plus processing, KRW bank payout minimum 40,000), and **PayPal** (not an MoR, 4.4% + fixed fee for cross-border receipts). The fixed per-transaction fees (40–95¢) take roughly 13–30% of a USD 3–8 sale.

### Cited Findings
**Stripe / Stripe Managed Payments**
- **Stripe country list [official, fetched]**: South Korea is not listed, either as available or as preview. Listed APAC countries: AU, HK, IN (preview), ID (preview), JP, MY, NZ, SG, TH. — [Stripe Global](https://stripe.com/global)
- **Managed Payments eligibility [official, fetched]**: supported business locations are CA, US, 29 European countries, AU, HK, JP, SG. **KR is not listed.** Eligible products are digital: software, video games, digital media and images, online courses, electronically supplied services. **Products involving human intervention do not qualify.** Customers can be in 195+ countries (except China, Russia, North Korea, Iran and a few others). Tax codes include "Digital Greeting Cards – Audio Visual" and "Electronically Supplied Services". — [Stripe Managed Payments eligibility](https://docs.stripe.com/payments/managed-payments/eligibility)
- **Managed Payments fee [reported]**: 3.5% per successful transaction **on top of** standard Stripe processing, calculated on the full amount including tax. Launched as a beta in April 2025. — [search summary of Stripe/Paddle/Freemius pages](https://www.paddle.com/resources/stripe-managed-payments); [Freemius](https://freemius.com/blog/stripe-merchant-of-record/)
- **Stripe in Korea, conflicting reports [reported]**: one Korean blog claims you can sign up with a Korean business registration. A Korean developer on Indie Hackers says Stripe doesn't issue merchant accounts in Korea. The official country list above supports the second view. — [inblog](https://inblog.ai/kr/blog/stripe-in-korea); [Indie Hackers](https://www.indiehackers.com/post/stripe-doesnt-issue-merchant-accounts-in-my-country-i-shipped-a-paid-saas-anyway-24334be5cd)
- **Stripe can accept Korean payment methods [official, snippet]**: through a local processor partner, without a Korean entity. This is for non-Korean merchants selling into Korea. — [Stripe: South Korean payment methods](https://docs.stripe.com/payments/countries/korea)

**Lemon Squeezy**
- **[official, fetched]** Banner: "Lemon Squeezy is no longer accepting new sign-ups and will shut down on March 31, 2027", with a link to "Start with Managed Payments" on Stripe. The Republic of Korea is on its bank-payout list, which only matters for existing sellers. — [Lemon Squeezy supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)

**Paddle**
- **Seller eligibility [official, fetched]**: "Paddle works with software businesses anywhere in the world with the exception of the unsupported countries", and Korea is not on the unsupported list. — [Paddle: supported countries](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle)
- **Pricing [official, fetched]**: "5% + 50¢" per checkout transaction, pay-as-you-go, including tax and VAT compliance, fraud protection, chargebacks and buyer support. **"If you're selling product with under 10$ value you can contact us for bespoke pricing."** — [Paddle pricing](https://www.paddle.com/pricing)
- **Payouts [official, snippet]**: minimum payout threshold $100 (adjustable to $100,000). Balances below it roll over monthly. Methods are bank/wire, Payoneer (USD only) and PayPal. The seller pays bank, Payoneer and PayPal fees. — [Paddle: when and how do I get paid](https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid); [Paddle: payout fees](https://www.paddle.com/help/manage/get-paid/is-there-a-fee-taken-for-payouts). A third-party blog reports a $15/€15/£15 wire fee when currency and bank country differ, and payouts sent by the 15th of the month. — [Winvesta (reported)](https://www.winvesta.in/blog/businesses/paddle-payouts-india-fees-timing-bank-options)
- **Korean buyer payment methods [official, snippet]**: KakaoPay, Naver Pay, Payco, Samsung Pay and Korean cards for KRW purchases (added 2024). Korea is listed with KRW and "Inclusive" tax treatment. — [Paddle Korean payment methods changelog](https://developer.paddle.com/changelog/2024/korean-payment-methods); [Paddle supported countries/locales](https://developer.paddle.com/concepts/sell/supported-countries-locales)

**Polar**
- **Fees [official, fetched]**: Starter is free at 5% + 50¢. Pro is $20/month at 3.8% + 40¢. Growth is $100/month at 3.6% + 35¢. Scale is $400/month at 3.4% + 30¢. Legacy "Early Member" (orgs created before 2026-05-27) pays 4% + 40¢. **+1.5% for non-US cards.** Payouts cost $2/month when active, 0.25% + $0.25 per payout, and 0.25–1% cross-border. **Disputes cost $15 each regardless of outcome.** Refunds don't return the fee. — [Polar fees](https://polar.sh/docs/fees)
- **Korea payouts [official, fetched]**: South Korea is on the list. Polar (US) is the MoR and pays out via Stripe Connect Express. Individuals are eligible only where Stripe Connect Express supports the "individual" business type. — [Polar supported countries](https://polar.sh/docs/merchant-of-record/supported-countries)

**Dodo Payments**
- **Korea eligibility [official, fetched]**: "Republic of Korea" is on the list for merchant accounts and payouts. Individuals verify with a government ID. — [Dodo accepted countries](https://docs.dodopayments.com/miscellaneous/accepted-countries-and-territories)
- **Fees [official, fetched]**: 4% + $0.40 (US cards and wallets). **+1.5% for cards and APMs outside the US.** +0.5% for subscriptions. +3% for BNPL and PayPal. $1 per refund. **$30 per dispute.** Payouts are "free", but $5 when the payout is under $1,000, and USD SWIFT payouts to non-US businesses are $25. — [Dodo pricing](https://dodopayments.com/pricing)
- **Korean methods [official, snippet]**: Kakao Pay, Naver Pay, PAYCO and Korean local cards, billed in KRW. — [Dodo payment methods (ko)](https://docs.dodopayments.com/ko/features/payment-methods)

**Gumroad**
- **Fees [official, snippet]**: "10% + $0.50 fee + sales tax per transaction. This does not include credit card processing (2.9% + $0.30) and PayPal fees." Sales through Gumroad Discover reportedly cost 30%. — [Gumroad fees](https://gumroad.com/help/article/66-gumroads-fees.html); [Discover 30% (reported)](https://dodopayments.com/blogs/gumroad-fees-explained)
- **Korea payouts [official, snippet]**: bank payouts in KRW with a **minimum of 40,000 KRW**. Elsewhere it is $10 or PayPal in USD. — [Gumroad: getting paid](https://gumroad.com/help/article/13-getting-paid)

**PayPal (processor, not an MoR)**
- **[official, snippet; page updated 2026-05-28]**: Korean accounts receiving commercial payments from outside Korea pay **4.40% + fixed fee**. — [PayPal KR merchant fees](https://www.paypal.com/kr/webapps/mpp/merchant-fees) (403 on direct fetch)
- **[reported]**: the fixed fee is $0.30 for USD receipts. — [jab-guyver blog](https://jab-guyver.co.kr/5547). Withdrawing to a Korean bank account is free above KRW 150,000 and KRW 1,500 below it (no conversion). Currency conversion spread is 3.00% ("other" conversions). — [PayPal KR consumer fees](https://paypal.com/kr/digital-wallet/paypal-consumer-fees) [official, snippet]
- **Domestic PG route [official, fetched]**: Toss Payments offers PayPal as an overseas payment option (settles weekly + 4 days). — [Toss Payments 수수료](https://www.tosspayments.com/about/fee)

**FastSpring / PayPro Global**
- **FastSpring [reported]**: 8.9% flat, or 5.9% + $0.95. The effective rate on small transactions is high. — [G2](https://www.g2.com/compare/fastspring-vs-payproglobal); [Toolradar](https://toolradar.com/tools/fastspring/pricing)
- **PayPro Global [reported]**: no public rate. A competitor (Freemius) estimates 4.9% + $1, unconfirmed. — [Freemius](https://freemius.com/paypro-global-alternative/)

### Inferences
Fee as a share of the sticker price. Card sales only. Excludes FX spreads, payout fees, and the buyer's local VAT. If prices are VAT-inclusive (e.g., EU 20%), the seller's net falls further. Whether fees are charged on the tax-inclusive total varies by provider and was not confirmed except for Polar ("entire transaction amount") and Stripe MP (reported).

| Provider (role) | USD 3 | USD 5 | USD 8 | Notes |
|---|---|---|---|---|
| Paddle (MoR) 5% + 50¢ | $0.65 (21.7%) | $0.75 (15%) | $0.90 (11.3%) | Ask for <$10 bespoke pricing |
| Polar Starter (MoR) 5% + 50¢ + 1.5% non-US | $0.70 (23%) | $0.83 (16.5%) | $1.02 (12.8%) | Plus $2/mo + 0.25% + 25¢ per payout + cross-border |
| Dodo (MoR) 4% + 40¢ + 1.5% non-US | $0.57 (18.8%) | $0.68 (13.5%) | $0.84 (10.5%) | Plus $25 SWIFT or $5 for payouts under $1k; $30 per dispute |
| Gumroad 10% + 50¢ + 2.9% + 30¢ | $1.19 (39.6%) | $1.45 (28.9%) | $1.83 (22.9%) | Highest; KRW payout minimum 40,000 |
| FastSpring 5.9% + 95¢ (reported) | $1.13 (37.7%) | $1.25 (24.9%) | $1.42 (17.8%) | — |
| PayPal (not MoR) 4.4% + 30¢ | $0.43 (14.4%) | $0.52 (10.4%) | $0.65 (8.1%) | Seller owns foreign VAT and GST compliance; 3% FX spread |
| Toss domestic card, KRW 5,000 (~$3.6) | — | ~3.74% incl. fee-VAT | — | Korean buyers only (overseas cards and PayPal via Toss possible) |

- At USD 3–8, the fixed per-transaction fee dominates. **Bundling (e.g., a USD 8 "birthday pack" rather than USD 3 add-ons) or a prepaid credit pack** cuts the fee share roughly in half. Prepaid credits, however, are the "coin top-up" structure that domestic PGs screen more strictly (Q1), and that Stripe MP excludes when not "fully automated" (Q2).
- "24h virtual billboard + celebration video" auto-generated without human work fits MoR "digital product" definitions (Stripe's list even has "Digital Greeting Cards – Audio Visual"). If a human manually edits each video, Stripe MP-style rules exclude it, and other MoRs may question it.
- Paddle's "software businesses" wording and Polar/Dodo's developer focus mean onboarding review may question a consumer greeting-style product. Apply to two at once.
- A practical split: **Korean buyers → domestic PG (Toss/KCP/나이스 via PortOne)**, which is far cheaper at about 3.7%. **Foreign buyers → one MoR (Paddle or Dodo)**, so the MoR collects and remits foreign VAT/GST, and WISH BOARD avoids registering in the EU, UK, Japan and elsewhere.
- Payout friction: Paddle's $100 threshold and Gumroad's KRW 40,000 minimum mean money arrives monthly at best for a small seller. Dodo's $25 SWIFT fee on small payouts is material at low volume, so batch payouts.

### Gaps
- Whether Paddle accepts a Korean *individual* 개인사업자 selling a consumer greeting-style digital product was not confirmed. Its pages say "software businesses".
- Paddle's under-$10 bespoke rate is not published.
- PayPal's official micropayment rate for Korean accounts, and whether 4.4% applies to digital goods, could not be verified (official page returned 403).
- Whether Dodo's +1.5% "international" applies to a Korean merchant's buyers in all non-US countries (it is defined relative to US) was not clarified.
- Whether Stripe Connect Express supports "individual" for Korea (which governs Polar for a sole proprietor) was not checked.
- No official FastSpring or PayPro Global rate was retrieved.

---

## 3. Tax and compliance basics (영세율, VAT on foreign sales, MoR implications)

### Takeaway
Korea zero-rates (영세율) certain services supplied to non-residents and foreign corporations under 부가가치세법 §24①3 and 시행령 §33②1. This only applies to listed service categories, and payment must arrive in foreign currency through a foreign-exchange bank in the prescribed way. A 2026 국세청 advance ruling denied 영세율 where PayPal converted USD to KRW before remitting. Google AdSense income is widely treated as 영세율 (filed with a foreign-currency receipt certificate). An MoR makes the MoR, not WISH BOARD, the seller to foreign consumers, so foreign VAT is the MoR's problem. The Korean side becomes a supply to a foreign corporation, and its 영세율 status should be confirmed with a 세무사.

### Cited Findings
- **Legal basis [reported, aggregated from tax Q&A sites]**: foreign-currency-earning services are 영세율 under 부가가치세법 제24조①3호 and 시행령 제33조②1호 when supplied to a 비거주자 or 외국법인 without a domestic place of business. The services must be in the listed industries (e.g., parts of 정보통신업, 통신업, others). Payment must be received in the prescribed way: foreign currency through a 외국환은행 (received in KRW or exchanged), foreign-issued credit cards, and similar methods. — [bznav](https://ai.bznav.com/contents/3245130); [albup](https://albup.co.kr/page/interpretation_detail.php?com_idx=6698)
- **Reciprocity [reported]**: some categories (professional services, some business support services) qualify only if the foreign country grants reciprocal treatment (§25). — [albup](https://albup.co.kr/page/interpretation_detail.php?com_idx=10834)
- **Filing [reported]**: attach a 외화입금증명서. A missing attachment draws a penalty of 0.5% of the zero-rated tax base. — [mstacc](https://blog.mstacc.com/qa/부가세/1177)
- **2026 advance ruling, important [reported via taxly; ruling no. 사전-2026-법규부가-0981, 2026-09-22]**: a Korean business performed AI-evaluation work online for a US company, paid in USD through PayPal, which converted to KRW and remitted. Held: not a 국외공급 (performed in Korea), and **"외화수취요건을 충족하지 못하여 영세율 대상에 해당하지 않는 것임"**. — [taxly](https://taxly.kr/post/2011-부가세-국내에서-인터넷으로-해외에-용역제공한-경우-영세율-적용-여부)
- **Foreign corporation paying KRW directly [reported]**: a 2022 advance ruling denied 영세율 where a foreign corporation paid KRW directly to the Korean supplier. — summarized from [albup](https://albup.co.kr/page/interpretation_detail.php?com_idx=6698)
- **AdSense income [reported, multiple tax blogs]**: Google AdSense revenue is commonly filed as 영세율 (service supplied to a foreign business, paid in foreign currency). It must still be reported. Only 일반과세자 get refunds (간이과세자 cannot). Industry code choice (e.g., 921505 과세 vs 940306 면세) matters. — [wikidocs Insight_Lab (2026)](https://wikidocs.net/blog/@Insight_Lab/29318/); [glasswallet](https://glasswallet.com/calculate/adsense-tax/vat-guide)
- **Korean VAT rate on digital services [reported]**: the standard rate is 10%. — [PayPro Global: 대한민국 세율](https://payproglobal.com/ko/saas-%ed%8c%90%eb%a7%a4%ec%84%b8/south-korea/)
- **MoR mechanics [official, fetched]**: Polar: "all payments from customers are made to Polar (US)", and Polar is the MoR. — [Polar supported countries](https://polar.sh/docs/merchant-of-record/supported-countries). Paddle is described as legally the seller that remits VAT and sales tax. — [Paddle pricing](https://www.paddle.com/pricing)

### Inferences
- **Selling abroad via an MoR**: WISH BOARD's taxable supply is to the MoR (a foreign corporation such as Paddle UK, Polar US or Dodo), not to consumers, so no foreign VAT registration is needed. Korean 영세율 is plausible but hinges on two things:
  - the 업종 being on the 시행령 §33②1 list;
  - the payout arriving as foreign currency through a Korean 외국환은행. A USD wire to a 외화통장 that is then converted is the safe pattern. **A PayPal balance auto-converted to KRW is risky**, given the 2026 ruling.
  If 영세율 fails, the payout is likely taxed at 10% Korean VAT. Get a 세무사 opinion before choosing a payout method.
- **Selling abroad directly (PayPal or Toss overseas cards)**: WISH BOARD is the seller to foreign consumers. It may owe foreign digital-services VAT/GST (EU OSS, UK, Japan, Australia and others, depending on thresholds). This compliance burden is the main reason to use an MoR for foreign buyers.
- **Korean buyers via an MoR**: Paddle lists Korea as "Inclusive" tax, so it would collect 10% Korean VAT as a foreign e-service supplier. Routing Korean buyers through Paddle costs about 5% + 50¢ against about 3.7% domestically, and adds no benefit.
- **Registration**: register as a 일반과세자 (not 간이) if expecting 영세율 refunds. Domestic sales charge 10% VAT (price shown VAT-inclusive to consumers).

### Gaps
- I did not retrieve an official 국세청 or 기재부 page listing which 업종 under 시행령 §33②1 covers "online digital content / electronically supplied services to foreign consumers". The applicable 업종코드 for WISH BOARD (e.g., 전자상거래 소매 vs 정보통신 서비스) needs a 세무사.
- No official guidance found on whether MoR payouts (Paddle, Polar, Dodo) satisfy the 외화수취 requirement.
- Korean 전자상거래법 obligations (청약철회 for digital content, 통신판매업 신고) were out of scope and not researched.

---

## 4. Web advertising revenue (AdSense, Ad Manager, rewarded web, Korean networks, minors)

### Takeaway
Rewarded ads *on the web* exist through Google Ad Manager (GPT) and, more simply, through the **AdSense Offerwall's "rewarded ad" choice**. Google allows rewards like in-platform points with no cash value, provided they are usable only inside WISH BOARD, are not transferable, and the user opts in. AdSense pays publishers 80% after the buy-side fee (about 68% end-to-end for Google Ads demand). Reliable *web* rewarded eCPM data for Korea was not found. Mobile-app rewarded video benchmarks put the US at about $14–30 and Korea at about $10–22 eCPM, which web will likely undercut. Kakao AdFit accepts web sites and pays two months later. Naver AdPost is built around Naver blogs, not external sites.

### Cited Findings
- **Rewarded web requirements [official, fetched]**: rewarded ads can be trafficked on Ad Manager desktop, mobile and tablet web inventory. The publisher builds the opt-in screen and delivers the reward. Default "1 reward" per completed ad, configurable. **Optional server-side verification (SSV) callback for web.** Only one rewarded ad request at a time. A display ad must stay visible **at least 7 seconds** to grant the reward. "Block non-instream video ads" must be off. Video and display demand both fill by default. — [Ad Manager: rewarded ads for web](https://support.google.com/admanager/answer/9116812?hl=en)
  - Conflict: an earlier search summary said "server-side verification is app-only". The current official page documents SSV for web, so treat the official page as current.
- **Reward policy [official, fetched]**: allowed are indirect or non-monetary items "only redeemable and usable for an item or service within the publisher's platform, website or app" (examples: extra life, skins, discounts, loyalty points, free trials). **"Direct monetary items may not be offered as rewards under any circumstance"** (cash, crypto, gift cards). Points or physical items **transferable to another person are not permitted**. Discounts on physical items are capped at 25% of value. Random rewards are allowed only with odds disclosed beforehand and a chance above 0. Ads must be opt-in and skippable. Declining must not hinder normal use. Rewarded interstitials need an intro screen with a working "no" option. The page has no rules specific to children. — [Policies for ad units that offer rewards](https://support.google.com/admanager/answer/7496282)
- **AdSense Offerwall [official, snippet]**: "Rewarded ad" is currently the only user-choice option in AdSense Offerwall (Ad Manager offers more). It renders only if a rewarded ad is available, so low demand means no message. It requires the AdSense code on the site. — [AdSense Offerwall help](https://support.google.com/adsense/answer/13865318); [AdSense help](https://support.google.com/adsense/answer/12726063). PPC Land reports general availability. — [PPC Land (reported)](https://ppc.land/google-adsense-offerwall-is-generally-available-what-it-means/)
- **AdSense revenue share [official, fetched]**: "publishers receive 80% of the revenue, after the advertiser platform takes its fee". For Google Ads demand, "publishers keep about 68%". — [AdSense revenue share](https://support.google.com/adsense/answer/180195?hl=en)
- **AdSense eligibility [reported, consistent across guides citing Google]**: 18+, own and control the site (HTML access), original content, policy compliance, no traffic minimum. — [Google AdSense eligibility](https://support.google.com/adsense/answer/9724?hl=en) (official page not opened); [guide](https://freeacademy.ai/lessons/adsense-requirements)
- **Ad Manager small business [reported]**: free tier for smaller publishers, with country-specific impression limits before 360 is required. — [MonetizeMore](https://www.monetizemore.com/blog/google-ad-manager-small-business-vs-360/)
- **Minors and age treatment [official, snippet]**: TFUA and TFCD tags are deprecated in favor of the **Tag for Age Treatment (TFAT)**: 1 = child, 2 = teen treatment. COPPA covers US services directed to children under 13. Publishers remain responsible for legal compliance. — [IMA SDK consent docs](https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side/consent); [Ad Manager program policies](https://support.google.com/admanager/answer/3671211?hl=en)
- **Mobile-app rewarded video eCPM [reported, sources disagree several-fold]**:
  - Playio 2026: US $24.39 iOS / $30.25 Android, South Korea $20.94 iOS / $22.01 Android. — [Playio](https://blog.playio.co/mobile-game-ecpm-benchmarks-2026)
  - Maf.ad: US about $14, Korea about $10–11 (may be interstitial). — [Maf.ad](https://maf.ad/en/blog/mobile-ads-ecpm/)
  - Adnimation Q1 2024: US about $30, Korea about $29 iOS. — [Adnimation](https://www.adnimation.com/?p=14962)
  - AppFollow: $10–30 in top-tier markets (US/UK/JP/KR), tier 2 is 30–60% lower. — [AppFollow](https://appfollow.io/blog/mobile-game-ads-formats-monetization)
  - TopOn H1 2025: rewarded video eCPM up 18% YoY. Japan and Korea rank behind NA/EU. — [TopOn report](https://mores.toponad.com/reports/TopOn%20Global%20Mobile%20Games%20Monetization%20Report%20_%202025%20H1.pdf)
- **Web rewarded and interstitial benchmarks**: AnyMind publishes a web-specific "eCPM Trends for Interstitial & Rewarded Ads 2024 & Q1 2025" report, but the figures are gated behind a form. — [AnyMind](https://anymindgroup.com/?p=49164)
- **AdSense RPM by region [reported, unsourced blog]**: high-income regions $20–50+ RPM, low-income $1–5. No Korea figure. — [Ranktracker](https://www.ranktracker.com/ko/blog/comparing-adsense-rpm-in-high-income-vs-low-income-regions/)
- **Kakao AdFit [official, snippet]**: requires a Kakao account. Web, Android and iOS media types; web needs a URL and category. Media review starts after ad calls begin. Earnings are paid **the month after next** (익익월). Payment requests run from the 21st to month end. The account holder name must match. — [Kakao AdFit 가이드](https://kakaobusiness.gitbook.io/main/partner/adfit/join); [AdFit 정산](https://kakaobusiness.gitbook.io/main/partner/adfit/start/pay)
- **Naver AdPost [official, snippet; Naver press release, undated]**: membership is reviewed on blog age, last month's UV/PV and post count. Age 20+ per the press release, 19+ per blogs. — [Naver press release](https://navercorp.com/media/pressReleasesDetail?seq=27910); [adsensefarm (reported)](https://adsensefarm.kr/naver-adpost-requirements-application-guide-2026/)

### Inferences
- WISH BOARD's "watch an ad → get plaza points (no cash value, non-transferable, spend only in-plaza)" fits Google's reward policy. Making points giftable to other users would break the "transferable" rule. Points must never convert to coupons or gift cards.
- The simplest start is **AdSense + Offerwall (rewarded ad choice)**. Full Ad Manager GPT rewarded slots give more control (SSV to credit points server-side, which matches the Worker architecture) but need an Ad Manager account and enough demand.
- A 3D WebGL plaza has few classic "content pages". AdSense review of a canvas-heavy site with little text may be harder (not confirmed). Display slots outside the canvas (lobby or result pages) are more conventional.
- Revenue math (illustrative, using a conservative web rewarded eCPM of about $5–15, unverified for web): 1,000 rewarded views/day ≈ $5–15/day gross ≈ $3.4–10 to the publisher at 68%. Ads are a supplement, not a core revenue line, at small scale.
- For a site with many minors (K-pop fan audience), set age treatment (TFAT teen/child) where users are known minors, which reduces personalized demand and eCPM. Collecting age at sign-up has its own Korean 개인정보보호법 implications (under-14 parental consent), not researched here.

### Gaps
- No verifiable **web** rewarded eCPM for Korea or the US (AnyMind data gated). All numbers above are mobile-app benchmarks.
- No official Korea AdSense RPM.
- Exact Ad Manager small-business impression limits for Korea not retrieved.
- Kakao AdFit revenue share and minimum payout not found.
- Whether Naver AdPost accepts external (non-Naver) websites was not confirmed either way.
- Google's AdSense policy on content "directed at children" for non-US (Korean) sites was not specifically retrieved.

---

## 5. B2B ad sales benchmarks (virtual-space placements, sponsored events, fan-community ads)

### Takeaway
Big platforms price virtual-world brand exposure very cheaply per impression (Roblox's 2027 creator integration fee in South Korea is $0.20 per thousand visits), while bespoke builds cost mid-six figures (Fortnite UEFN). For WISH BOARD the more relevant anchors are fan "birthday ads": a real Times Square personal 24h slot is about $150, business slots are $250–1,000/day (vendor claim), and premium Times Square towers start at about $17,500/day. In Seoul, 12,433 idol ads ran in the subway in one year. No public rate cards were found for ZEPETO brand deals or Korean fan-community site banners.

### Cited Findings
- **Roblox [reported, PocketGamer.biz 2026-06-19, citing Roblox]**: from **2027-01-01**, creator brand-integration fees switch to a CPM per thousand visits. US $1.50; UK/CA/AU/NZ/Nordics $0.75; **Western Europe, Japan, South Korea $0.20**; rest of world $0.05. All impressions drop to a flat $0.10 after 28 days live. Forecasts and caps are based on the prior 56 days. — [PocketGamer.biz](https://www.pocketgamer.biz/roblox-reveals-creator-fee-structure-for-brand-integrations-from-2027/)
- **Roblox centrally sold formats [reported]**: Immersive Ads and Rewarded Video. — [Make Influence](https://www.makeinfluence.com/en/academy/in-game-influencer-marketing-brand-activations-in-roblox-and-fortnite)
- **Fortnite UEFN [reported, Digiday]**: studio-quality branded islands "routinely run into the mid six figures". Creators argue brands overspend on custom maps instead of integrating into existing popular experiences. "Sponsored Row" is a bid-based Discover placement with no published rate. — [Digiday](https://digiday.com/media/fortnite-advertising-friction-creators-say-brands-are-wasting-money-on-custom-maps)
- **ZEPETO [reported, Digiday]**: launched a global brand partnership program in June 2024. No pricing published. — [Digiday on Zepeto](https://digiday.com/marketing/what-marketers-need-to-know-about-zepeto-the-korean-metaverse-platform/); comparison: [Jing Daily](https://jingdaily.com/posts/roblox-fortnite-zepeto-which-offers-brands-more-bang-for-their-buck)
- **Real Times Square personal billboard [reported, Fox stations]**: about $150 for a photo shown 15 seconds once an hour for 24 hours (TimesSquareBillboard.com). Business ads are $250–1,000/day per the vendor's own 2025 article. Nasdaq Tower 1-day campaigns are about $17,500 and MiFi about $27,000 per a Feb 2026 press release. — [Fox 5 NY](https://www.fox5ny.com/news/rent-billboard-nyc-times-square-photo-150); [vendor (reported)](https://timessquarebillboard.com/?p=173522); [Digital Journal PR](https://www.digitaljournal.com/pr/news/binary-news-network/2026-insider-guide-times-square-153436415.html). A $40 for 15 seconds offer was also reported. — [Sixteen:Nine](https://www.sixteen-nine.net/?p=36161)
- **Seoul subway fan ads [reported]**: 12,433 idol ads cleared review and ran in the Seoul subway in one year (서울교통공사 figure, cited by Dailian). On Jungkook's birthday, ads ran at 24 stations. — [데일리안](https://www.dailian.co.kr/news/view/1694327/). Hapjeong station ad prices rose about 1.5–2× in June 2025 after an agency bid about twice the floor, leaving more boards vacant. — [파이낸셜뉴스](https://www.fnnews.com/news/202506221857541605)
- **Nate "오늘광고" [reported]**: Nate sells user birthday ads on its main page as a new fan-ad medium. Price not captured. — [ampm insight](https://inside.ampm.co.kr/insight/13451)

### Inferences
- Pricing anchors for WISH BOARD's consumer product: a virtual 24h birthday billboard at KRW 3,000–10,000 (USD 2–7) sits well below the real Times Square personal slot ($150) and Seoul subway fan ads (unpublished, but agencies quote budgets far above this). This supports the "affordable alternative or companion to a real fan ad" positioning.
- For B2B slots, Roblox's $0.20 CPM (Korea) shows the floor for pure impressions in virtual worlds is very low. Small-brand deals in a niche plaza will sell as **flat-fee sponsorships** (an event day, a named billboard, a themed weekend), not per impression. Plausible pricing would be benchmarked against fan-ad budgets and Korean community banner flat rates (not found), not CPM.
- Bespoke builds (Fortnite-style) are out of reach for small brands, which leaves an opening for cheap templated placements (logo on a plaza screen, sponsored celebration effect).

### Gaps
- No public rate card for ZEPETO brand partnerships, Roblox pre-2027 deals, or Fortnite Sponsored Row.
- No published banner rates for Korean fan communities (e.g., 디시인사이드, 더쿠, 위버스-adjacent sites) or Korean fan-ad agencies (subway, café, LED). These are quote-only. Direct outreach to agencies (e.g., kmong listings) would be needed.
- No data on what small Korean brands pay for virtual-event sponsorships specifically.
