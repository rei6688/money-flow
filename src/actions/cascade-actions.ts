'use server';

import { pocketbaseList, toPocketBaseId } from '@/services/pocketbase/server';

export async function getRecentShopByCategoryId(categoryId: string): Promise<string | null> {
    try {
        const pbCatId = toPocketBaseId(categoryId, 'categories')
        const response = await pocketbaseList<{ shop_id?: string | null }>('transactions', {
            filter: `category_id='${pbCatId}' && shop_id != ''`,
            sort: '-date',
            perPage: 1
        })
        return response.items[0]?.shop_id || null
    } catch (err) {
        console.error('PB: getRecentShopByCategoryId failed:', err)
        return null
    }
}

export async function getRecentShopIdsByCategoryId(categoryId: string): Promise<string[]> {
    try {
        const pbCatId = toPocketBaseId(categoryId, 'categories')
        const response = await pocketbaseList<{ shop_id?: string | null }>('transactions', {
            filter: `category_id='${pbCatId}' && shop_id != ''`,
            sort: '-date',
            perPage: 50
        })
        const ids = response.items.map(t => t.shop_id).filter(Boolean)
        return Array.from(new Set(ids)).slice(0, 10)
    } catch (err) {
        console.error('PB: getRecentShopIdsByCategoryId failed:', err)
        return []
    }
}

export async function getRecentCategoriesByShopId(shopId: string): Promise<string[]> {
    try {
        const pbShopId = toPocketBaseId(shopId, 'shops')
        const response = await pocketbaseList<{ category_id?: string | null }>('transactions', {
            filter: `shop_id='${pbShopId}' && category_id != ''`,
            sort: '-date',
            perPage: 50
        })
        const ids = response.items.map(t => t.category_id).filter(Boolean)
        return Array.from(new Set(ids)).slice(0, 5)
    } catch (err) {
        console.error('PB: getRecentCategoriesByShopId failed:', err)
        return []
    }
}

export async function getRecentCategoryShopByAccountId(
    accountId: string,
): Promise<{ categoryId: string | null; shopId: string | null }> {
    try {
        const pbAccountId = toPocketBaseId(accountId, "accounts");
        const response = await pocketbaseList<{
            category_id?: string | null;
            shop_id?: string | null;
        }>("transactions", {
            filter:
                `account_id='${pbAccountId}' && category_id != '' && status != 'void'`,
            sort: "-date",
            perPage: 20,
        });

        const firstMatched = response.items.find((tx) => !!tx.category_id) || null;
        return {
            categoryId: firstMatched?.category_id || null,
            shopId: firstMatched?.shop_id || null,
        };
    } catch (err) {
        console.error("PB: getRecentCategoryShopByAccountId failed:", err);
        return { categoryId: null, shopId: null };
    }
}
