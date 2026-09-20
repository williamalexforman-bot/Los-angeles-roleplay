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

function information(){return make('information','Central Pierce Fire & Rescue',[
`Welcome to the **Central Pierce Fire & Rescue**. CPFR is the department responsible for stopping fires, rendering medical aid, and more. Use the menu below to learn about CPFR and navigate the server. Apply today for an immersive firefighting experience.`,
`### Department Leadership\n\n**Fire Chief:** @FR101 | M. Smith\n**Deputy Fire Chief:** @FR102 | C. Thundercock\n**Assistant Fire Chief:** @FR103 | D. Love\n**Assistant Fire Chief:** @FR104 | J.kripe\n\n> More information can be found below.`
],[new D.StringSelectMenuBuilder().setCustomId('cpfr:information').setPlaceholder('Explore Central Pierce Fire & Rescue').addOptions({label:'Discord Regulations',value:'regulations',description:'Read the community rules privately.'})]);}

function ticket(){return make('assistance','Support',[
`The **Central Pierce Fire & Rescue Support Center** is the primary system for submitting requests, reports, concerns, and other department-related matters. Tickets are reviewed and assigned by category and priority so they reach the right personnel.`,
`### General Support\n> General questions, assistance, technical issues, and department requests.`,
`### Office of Internal Affairs\n> Complaints, staff conduct concerns, policy violations, investigations, or matters requiring confidential internal review.`,
`### Office of the Chief\n> Command-level matters, department concerns, appeals, or issues requiring the Office of the Chief.`,
`### Ticket Information\n> Please select the appropriate category and include accurate details so the correct team can review and resolve your matter efficiently.`
],[new D.StringSelectMenuBuilder().setCustomId('ticket:create').setPlaceholder('Choose a support department').addOptions(
 ...Object.entries(TICKETS).map(([value,label])=>({label,value,description:TICKET_DESCRIPTIONS[value]}))
)]);}

function employee(){return make('employee','Employee Information',[
`Welcome to the **Central Pierce Fire & Rescue**. This panel explains how to operate in the field and provides the roster, standard operating procedure, and truck roster.`,
`**Standard Operating Procedure**\nView the SOP to understand how to operate in the field.`,
`**Truck Roster**\nView the truck roster so you know the approved apparatus.`,
`**Our Roster**\nView the roster of employed CPFR members.`
],[
new D.ButtonBuilder().setCustomId('cpfr:sop').setLabel('SOP').setStyle(D.ButtonStyle.Secondary).setDisabled(true),
new D.ButtonBuilder().setCustomId('cpfr:trucks').setLabel('Truck Roster').setStyle(D.ButtonStyle.Secondary).setDisabled(true),
new D.ButtonBuilder().setLabel('Open Our Roster').setStyle(D.ButtonStyle.Link).setURL('https://docs.google.com/spreadsheets/d/10QA9b2DxEMOkuT5scmQvkeNb8TS1q1q3_jy0yxDPqfE/edit?usp=sharing')
]);}

function cadet(){return make('cadet','Cadet Information',[
`Welcome to the Central Pierce Fire & Rescue. As a Cadet, you are entering the first phase of your career. This guide is your foundation: performance, discipline, and willingness to learn determine advancement to Probationary Firefighter or EMT.`,
`### Guidelines & Conduct\n**Follow the Chain of Command** — listen to instructors, officers, and senior cadets.\n**Rules & Expectations** — stay professional, safe, and respectful.\n**Cadet Responsibilities** — show up prepared, follow directions, and represent the program well.`,
`### Training & Ride-Along\n**Cadet Training** — complete basic EMS and FD skills training before real-world activities.\n**Ride-Along Experience** — after training, cadets may observe calls under supervision to learn how EMS and FD operate.`,
`### FD Cadet Quick Facts\n**Perimeter Check** — scan the outside of a scene for hazards, smoke, or changing conditions.\n**Scene Awareness** — stay alert, watch your surroundings, and know where crews and equipment are.\n**Basic Support** — assist with simple tasks only when directed by certified personnel.`,
`### EMS Cadet Quick Facts\n**Bleeding Control** — use gauze and firm pressure when directed.\n**Check ABCs** — Airway, Breathing, Circulation: check these first.\n**Pulse Check** — know where and how to check a pulse during patient assessment.`
]);}

function oia(){return make('oia','Office of Internal Affairs',[
`### Case Process\n**I.** Claim the ticket and greet the user with the Ticket Answering Format from the case resources channel.\n\n**II.** Investigate the report, review evidence, and collect a statement from the reporting user.\n\n**III.** Add the firefighter being reported with \`/add\`, then greet them with the Case Statement Format and collect their statement.\n\n**IV.** Gather statements and evidence, complete your investigation, determine the appropriate infraction, and make a case log in Case Logs.\n\n**V.** Log the infraction in the infractions channel, inform everyone involved of the conclusion, and finish the ticket.`,
`### OIA | Responsibilities & Expectations\nThe Office of Internal Affairs investigates complaints, misconduct, and policy violations within CFR while maintaining fairness and professionalism.\n\n- Conduct investigations with no bias or favoritism.\n- Review evidence and reports.\n- Interview involved personnel.\n- Maintain confidentiality.\n- Recommend corrective actions when necessary.\n\n*The OIA directive team expects all OIA members to remain professional and unbiased. OIA members may still be infracted at any time.*`,
`### OIA | Other\nThis section serves as a bulletin board for weekly OIA updates.\n\n- All infractions must be approved by a Supervisory Investigator+.\n- Any infraction may be given for an offence; the investigator handling the case determines what is appropriate.\n\n[OIA Notice Document](https://docs.google.com/document/d/1_K1qQ-CTBG5bH830Aesa2ANttK0zX2CBws-H-nuOYck/edit?usp=sharing)`
]);}

const panels={information,ticket,employee,cadet,oia};
function get(type){if(!panels[type])throw new Error('Unknown panel.');return panels[type]();}
module.exports={get,regulations};
