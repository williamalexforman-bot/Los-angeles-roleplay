const D=require('discord.js');
const {row}=require('./panels');
const {decorate}=require('./branding');
const {TICKETS,TICKET_DESCRIPTIONS}=require('./settings');

function display(content){return new D.TextDisplayBuilder().setContent(content);}
function make(type,title,sections,controls=[]){
 const box=new D.ContainerBuilder().setAccentColor(0xB21F24).addTextDisplayComponents(display(`## ${title}`));
 for(const [index,text] of sections.entries()){
  if(index)box.addSeparatorComponents(new D.SeparatorBuilder());
  box.addTextDisplayComponents(display(text));
 }
 for(const control of controls)box.addActionRowComponents(row(control));
 decorate(box,`cpfr:${type}`);
 return {components:[box],flags:D.MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}

const regulations=`## Discord Regulations

\`-\` **1. Respect**\n> Treat others the way you want to be treated. Communicate respectfully and avoid harassment, discrimination, and offensive language.\n
\`-\` **2. Not Safe For Work**\n> Do not share NSFW material. NSFW messages, images, links, or related content can result in a permanent ban.\n
\`-\` **3. Toxicity**\n> Toxicity, manipulative behaviour, and selfish behaviour are prohibited and may result in a timeout or ban.\n
\`-\` **4. Discrimination**\n> Antisemitic, racist, or homophobic remarks are never tolerated and will result in a permanent ban.\n
\`-\` **5. Advertising**\n> Do not advertise without permission. DM advertising can result in a permanent ban.\n
\`-\` **6. Harassment**\n> Targeted harassment of one or more members can result in a timeout or ban.\n
\`-\` **7. Spam**\n> Flooding channels with messages, images, or links results in a timeout. Scam links result in a ban.\n
\`-\` **8. Profiles**\n> Inappropriate names, profile photos, banners, and similar content are prohibited.\n
\`-\` **9. Language**\n> This is an English-only community.\n
\`-\` **10. Discord Terms of Service**\n> Failure to follow Discord's Terms of Service results in an immediate ban.\n
\`-\` **11. Roblox Terms of Service**\n> Failure to follow Roblox's Terms of Service or Terms of Use results in an immediate ban.`;

function information(){return make('information','Clearwater Fire Department',[
`Welcome to the **Clearwater Fire Department**. CFD protects the community through fire suppression, emergency medical care, and additional response services. Use the menu below to explore the department and find important server information. Apply today to begin your firefighting experience.`,
`### Department Leadership\n\n**Fire Chief:** @FR101 | M. Smith\n**Deputy Fire Chief:** @FR102 | C. Thundercock\n**Assistant Fire Chief:** @FR103 | D. Love\n**Assistant Fire Chief:** @FR104 | J.kripe\n\n> Use the menu below to view additional department information.`
],[new D.StringSelectMenuBuilder().setCustomId('cpfr:information').setPlaceholder('Explore Clearwater Fire Department').addOptions({label:'Discord Regulations',value:'regulations',description:'Read the community rules privately.'})]);}

function ticket(){return make('assistance','Support',[
`<:Arrow:1546628745471721633> The **Clearwater Fire Department Support Center** handles requests, reports, concerns, and other department matters. Each ticket is sorted by category and priority so it reaches the appropriate personnel.`,
`### <:Ticket:1546624901031530596> General Support\n> Questions, general assistance, technical problems, and department requests.`,
`### <:IA:1546629494419492994> Internal Affairs\n> Complaints, conduct concerns, policy violations, investigations, and matters requiring a confidential review.`,
`### <:guidelines:1546628708109131776> Office of the Chief\n> Command-level requests, department concerns, appeals, and matters requiring the Office of the Chief.`,
`### <:app:1546630044468773025> Ticket Information\n> Select the category that best fits your request and provide clear, accurate details so the correct team can assist you efficiently.`
],[new D.StringSelectMenuBuilder().setCustomId('ticket:create').setPlaceholder('Choose a support department').addOptions(
 ...Object.entries(TICKETS).map(([value,label])=>({label,value,description:TICKET_DESCRIPTIONS[value]}))
)]);}

function employee(){return make('employee','Employee Information',[
`Welcome to the **Clearwater Fire Department Employee Center**. Use this panel to review field expectations, the standard operating procedure, approved apparatus, and the department roster.`,
`**Standard Operating Procedure**\nReview the SOP before operating in the field.`,
`**Truck Roster**\nCheck the truck roster for currently approved apparatus.`,
`**Department Roster**\nView the current roster of CFD personnel.`
],[
new D.ButtonBuilder().setCustomId('cpfr:sop').setLabel('SOP').setStyle(D.ButtonStyle.Secondary).setDisabled(true),
new D.ButtonBuilder().setCustomId('cpfr:trucks').setLabel('Truck Roster').setStyle(D.ButtonStyle.Secondary).setDisabled(true),
new D.ButtonBuilder().setLabel('Open Our Roster').setStyle(D.ButtonStyle.Link).setURL('https://docs.google.com/spreadsheets/d/10QA9b2DxEMOkuT5scmQvkeNb8TS1q1q3_jy0yxDPqfE/edit?usp=sharing')
]);}

function cadet(){return make('cadet','Cadet Information',[
`Welcome to the Clearwater Fire Department Cadet Program. This is the first stage of your career, where professionalism, discipline, performance, and a willingness to learn guide advancement to Probationary Firefighter or EMT.`,
`### Guidelines & Conduct\n**Follow the Chain of Command** — listen to instructors, officers, and senior cadets.\n**Rules & Expectations** — remain professional, safe, and respectful.\n**Cadet Responsibilities** — arrive prepared, follow instructions, and represent the program professionally.`,
`### Training & Ride-Along\n**Cadet Training** — complete basic EMS and fire-department skills training before field activities.\n**Ride-Along Experience** — once trained, cadets may observe calls under supervision and learn how fire and EMS crews operate.`,
`### FD Cadet Quick Facts\n**Perimeter Check** — scan the outside of a scene for hazards, smoke, or changing conditions.\n**Scene Awareness** — stay alert, watch your surroundings, and know where crews and equipment are.\n**Basic Support** — assist with simple tasks only when directed by certified personnel.`,
`### EMS Cadet Quick Facts\n**Bleeding Control** — use gauze and firm pressure when directed.\n**Check ABCs** — Airway, Breathing, Circulation: check these first.\n**Pulse Check** — know where and how to check a pulse during patient assessment.`
]);}

function oia(){return make('oia','Office of Internal Affairs',[
`### Case Review Process\n**I.** Claim the ticket and welcome the user with the Ticket Answering Format from the case resources channel.\n\n**II.** Review the report and available evidence, then collect a statement from the reporting user.\n\n**III.** Add the reported firefighter with \`/add\`, use the Case Statement Format, and collect their statement.\n\n**IV.** Organize all statements and evidence, complete the investigation, determine the appropriate outcome, and create a case log.\n\n**V.** Record the approved outcome, notify everyone involved of the conclusion, and close the ticket properly.`,
`### OIA | Responsibilities & Expectations\nThe Office of Internal Affairs investigates complaints, misconduct, and policy violations within CFR while maintaining fairness and professionalism.\n\n- Conduct investigations with no bias or favoritism.\n- Review evidence and reports.\n- Interview involved personnel.\n- Maintain confidentiality.\n- Recommend corrective actions when necessary.\n\n*The OIA directive team expects all OIA members to remain professional and unbiased. OIA members may still be infracted at any time.*`,
`### OIA | Notices\nUse this section as the bulletin board for weekly OIA updates.\n\n- All infractions must be approved by a Supervisory Investigator+.\n- Any infraction may be given for an offence; the investigator handling the case determines what is appropriate.\n\n[OIA Notice Document](https://docs.google.com/document/d/1_K1qQ-CTBG5bH830Aesa2ANttK0zX2CBws-H-nuOYck/edit?usp=sharing)`
]);}

const panels={information,ticket,employee,cadet,oia};
function get(type){if(!panels[type])throw new Error('Unknown panel.');return panels[type]();}
module.exports={get,regulations};
