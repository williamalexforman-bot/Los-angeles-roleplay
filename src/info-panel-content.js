module.exports=[];
/* Retired USMS-only panel definitions. Clearwater panels are in department-panels.js.
{key:'opr',channel:'1544312835125940294',sections:[
`# <:OPR:1548686777848561796> | Office of Professional Responsibility

**WELCOME TO THE OFFICE OF PROFESSIONAL RESPONSIBILITY**

The **Office of Professional Responsibility (OPR)** is responsible for maintaining the integrity, accountability, and professional standards of the United States Marshal Service.

As an OPR member, you are entrusted with handling **internal investigations and misconduct matters** involving USMS personnel. Your role requires professionalism, impartiality, discretion, and the ability to make decisions based on evidence rather than personal relationships or opinions.`,
`## <:handshake:1543417918858076263> | YOUR RESPONSIBILITIES

OPR personnel are responsible for:

* Investigating allegations of deputy misconduct.
* Reviewing evidence and statements relating to internal incidents.
* Determining whether departmental policies or SOPs have been violated.
* Maintaining accurate and organised investigation records.
* Remaining impartial throughout every investigation.
* Maintaining strict confidentiality regarding OPR matters.
* Providing appropriate disciplinary recommendations when necessary.
* Reporting significant findings to OPR command.`,
`## <:Warn:1543223000231313469> | OPR EXPECTATIONS

All OPR personnel are expected to maintain a **higher standard of professionalism** than regular department personnel.

You must:
**Remain Neutral** - Personal relationships, rank, popularity, or previous experiences must never influence an investigation.

**Protect Confidentiality** - Information relating to active or completed investigations must not be shared outside of authorised OPR personnel.

**Follow Procedure** - Every investigation must be conducted fairly and in accordance with USMS policies and OPR procedures.

**Document Everything** - Evidence, statements, findings, and disciplinary recommendations should be properly recorded.

**Use Sound Judgement** - Do not make disciplinary decisions based on assumptions. Investigations should be supported by clear evidence.`,
`## <:OPR:1548686777848561796> | INVESTIGATION PRINCIPLE

**Presumed innocent until evidence proves otherwise.**

OPR personnel are not here to automatically punish deputies. Our responsibility is to establish the facts, determine whether misconduct occurred, and ensure appropriate action is taken when necessary.

Every investigation should be approached with the same level of seriousness, regardless of the rank or position of the individual being investigated.`,
`## CHAIN OF COMMAND

All OPR personnel are expected to follow the OPR chain of command when handling investigations, requesting assistance, or escalating matters.

If you are unsure how to proceed with an investigation, **consult your OPR Command rather than making assumptions or taking unauthorised action.**`
]},
{key:'chain',channel:'1536278294494978108',sections:[
`## <:usms:1543987676603228160> | Official Chain of Command

> All USMS personnel are required to follow the established chain of command when escalating operational, administrative, or personnel matters.`,
...Object.entries({
'BOARD OF DIRECTORS':['1548003139037429811','1548003276065214495','1548003366083498024','1548003276065214495','1548003699438264321'],
'LEADERSHIP TEAM':['1548003746909524069','1548003771131629738','1548003856955211816','1548003797979111555'],
'SENIOR HIGH RANK TEAM':['1548003947808301190','1548004281339224136','1548004219234156584','1548004355733716992','1548004378781425735'],
'HIGH RANK TEAM':['1548004430501380249','1548004460008181780','1548004469986431108','1548004500844060872','1548004529847406774'],
'MIDDLE RANK TEAM':['1548004606364221520','1548004633304109186','1548004650530377879','1548004667328430110','1548004687377076417'],
'LOW RANK TEAM':['1548004761909862490','1548004799960711280','1548004818428239933','1548004840343601274'],
'OUR ACADEMY RANKS':['1548004871725260900','1548004951824015491']
}).map(([title,roles])=>`> **${title}:**\n>\n`+roles.map(id=>`> * <@&${id}>`).join('\n')),
`> **IMPORTANT:** Personnel should attempt to resolve matters through their immediate supervisor before escalating them further up the chain of command, unless the circumstances require otherwise.`
]},
{key:'guidelines',channel:'1536201774669631498',sections:[
`## <:usms:1543987676603228160> | Official Guidelines

> All members within the United States Marshal Service discord must follow and abide by these guidelines.

> Failure to do so will result in disciplinary action in the main server (TCRP) and this server.`,
`> **1. Nickname:** You must use your Roblox username or roleplay name as your nickname.
>
> **2. Profanity:** Mild swearing is permitted; excessive or vulgar profanity is not.
>
> **3. Advertising:** Advertising servers, games, services, or social media platforms in chats or DMs is prohibited. Unauthorised advertising may result in a **ban.**
>
> **4. English-only:** Please only use English in public channels for effective communication and moderation.
>
> **5. NSFW:** NSFW, sexual, or inappropriate content is strictly prohibited and may result in an immediate blacklist and ban.`
]}
]; */
