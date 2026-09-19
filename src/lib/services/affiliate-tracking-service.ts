import { DateTime } from "luxon";
import { adminDb } from "@/lib/firebase/admin";
import type { AffiliatePostRef, PostDoc, ProductCatalogDoc } from "@/lib/types";
import { shouldAutoArchiveProduct } from "@/lib/affiliate-performance";
export type AffiliateLinkResult={status:"not_applicable"|"linked"|"pending";productId?:string;deduplicated?:boolean;reason?:string};
function refs(v:unknown):AffiliatePostRef[]{return Array.isArray(v)?v as AffiliatePostRef[]:[];}
export async function linkAffiliatePostToProduct(post:PostDoc):Promise<AffiliateLinkResult>{
  const productId=post.affiliate_product_id?.trim(); if(!productId) return {status:"not_applicable"};
  const productRef=adminDb.collection("products").doc(productId), postRef=adminDb.collection("posts").doc(post.id), now=DateTime.utc().toISO()!;
  return adminDb.runTransaction(async(transaction)=>{
    const productSnap=await transaction.get(productRef); const persistedPost=await transaction.get(postRef); if(!persistedPost.exists) throw new Error("Published post record is missing.");
    if(!productSnap.exists){transaction.set(postRef,{affiliate_link_status:"pending",affiliate_link_error:"Affiliate product not found: "+productId,affiliate_link_updated_at:now},{merge:true});return {status:"pending",productId,reason:"product_not_found"};}
    const product={id:productSnap.id,...productSnap.data()} as ProductCatalogDoc, current=refs(product.post_refs), duplicate=current.some((r)=>r.platform===post.platform&&r.platform_post_id===post.platform_post_id);
    const next:AffiliatePostRef={account_id:post.account_id,platform:post.platform,post_id:post.id,platform_post_id:post.platform_post_id,product_id:productId,...(post.affiliate_creative_id?{creative_asset_id:post.affiliate_creative_id}:{}),posted_at:post.created_at};
    transaction.update(productRef,{post_refs:duplicate?current:[...current,next],lifecycle_state:product.lifecycle_state==="evaluated"?"evaluated":"posted",updated_at:now});
    transaction.set(postRef,{affiliate_link_status:"linked",affiliate_link_error:null,affiliate_linked_at:now,affiliate_link_updated_at:now},{merge:true}); return {status:"linked",productId,deduplicated:duplicate};
  });
}
export async function reconcileAffiliateLinkForPost(postId:string):Promise<AffiliateLinkResult>{const s=await adminDb.collection("posts").doc(postId).get();if(!s.exists)return{status:"pending",reason:"post_not_found"};const p={id:s.id,...s.data()} as PostDoc;if(!p.affiliate_product_id)return{status:"not_applicable"};if(p.affiliate_link_status==="linked")return{status:"linked",productId:p.affiliate_product_id,deduplicated:true};return linkAffiliatePostToProduct(p);}
export async function getProductPerformanceWork(productLimit=100){
  const snapshot=await adminDb.collection("products").get(); const products=snapshot.docs.map((d)=>({id:d.id,...d.data()}) as ProductCatalogDoc).filter((p)=>(p.post_refs?.length??0)>0).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,productLimit);
  const ids=Array.from(new Set(products.flatMap((p)=>(p.post_refs??[]).map((r)=>r.post_id)))); const snaps=await Promise.all(ids.map((id)=>adminDb.collection("posts").doc(id).get())); const byId=new Map<string,PostDoc>(); snaps.forEach((d)=>{if(d.exists)byId.set(d.id,{id:d.id,...d.data()} as PostDoc);}); const now=DateTime.utc();
  const items=products.map((product)=>{const perf=product.performance?.posts??[];const trackedPosts=(product.post_refs??[]).map((ref)=>{const post=byId.get(ref.post_id)??null, at=DateTime.fromISO(ref.posted_at), age=at.isValid?Math.max(0,now.diff(at,"hours").hours):null, pp=perf.find((i)=>i.post_id===ref.post_id||(i.platform_post_id&&i.platform_post_id===ref.platform_post_id));return{ref,post:post?{id:post.id,account_id:post.account_id,platform:post.platform,platform_post_id:post.platform_post_id,created_at:post.created_at,metrics:post.metrics,fetched_at:post.fetched_at,affiliate_product_id:post.affiliate_product_id??null,affiliate_creative_id:post.affiliate_creative_id??null,affiliate_link_status:post.affiliate_link_status??null}:null,ageHours:age,due24h:age!==null&&age>=24&&!pp?.checkpoints?.["24h"],due72h:age!==null&&age>=72&&!pp?.checkpoints?.["72h"],recordedResult:pp?.result??null};});return{id:product.id,asin:product.asin,title:product.title,status:product.status,viral_score:product.viral_score??null,lifecycle_state:product.lifecycle_state??null,post_refs:product.post_refs??[],performance:product.performance??null,autoArchiveCandidate:shouldAutoArchiveProduct(product.performance),trackedPosts,updated_at:product.updated_at};});
  return{items,summary:{trackedProducts:items.length,trackedPosts:items.reduce((s,i)=>s+i.trackedPosts.length,0),due24h:items.reduce((s,i)=>s+i.trackedPosts.filter((p)=>p.due24h).length,0),due72h:items.reduce((s,i)=>s+i.trackedPosts.filter((p)=>p.due72h).length,0),autoArchiveCandidates:items.filter((i)=>i.autoArchiveCandidate).length}};
}
