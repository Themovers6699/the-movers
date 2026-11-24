export type Role='owner'|'office_admin'|'crew_leader'|'mover';
export function isOffice(role:Role){return role==='owner'||role==='office_admin'}
export function roleLabel(role:Role){return ({owner:'Owner',office_admin:'Office admin',crew_leader:'Crew leader',mover:'Mover'})[role]}
export function canManageStaff(role:Role){return isOffice(role)}
export function validReturnOrigin(value:string){try{const url=new URL(value);return url.protocol==='https:'||(url.protocol==='http:'&&(url.hostname==='localhost'||url.hostname==='127.0.0.1'))?url.origin+'/':null}catch{return null}}
