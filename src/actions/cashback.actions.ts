'use server'

import {
    getPocketBaseAccountCycleOptions,
    getPocketBaseCycleTransactions,
    getPocketBaseAccountDetails,
} from '@/services/pocketbase/account-details.service'
import { pocketbaseList, toPocketBaseId } from '@/services/pocketbase/server'
import { resolveCashbackPolicy } from '@/services/cashback/policy-resolver'
import { normalizePolicyMetadata } from '@/lib/cashback-policy'
import { CashbackTransaction } from '@/types/cashback.types'
import { TransactionWithDetails } from '@/types/moneyflow.types'

export async function fetchMonthlyCashbackDetails(cardId: string, month: number, year: number) {
    try {
        const pbAccountId = toPocketBaseId(cardId, 'accounts')
        const startDate = new Date(year, month - 1, 1).toISOString()
        const endDate = new Date(year, month, 1).toISOString()

        const response = await pocketbaseList<Record<string, unknown>>('transactions', {
            perPage: 500,
            sort: '-occurred_at',
            filter: `account_id='${pbAccountId}' && occurred_at>='${startDate}' && occurred_at<'${endDate}' && type='debt' && status!='void'`,
            expand: 'category_id',
            fields: 'id,occurred_at,note,amount,type,cashback_amount,cashback_share_percent,cashback_share_fixed,expand',
        })

        return (response.items || []).map((t: Record<string, unknown>) => {
            const expanded = t.expand as Record<string, unknown> | undefined
            const category = expanded?.category_id as Record<string, unknown> | undefined
            return {
                id: t.id,
                occurred_at: t.occurred_at,
                note: t.note,
                amount: Number(t.amount || 0),
                type: t.type,
                cashback_share_percent: t.cashback_share_percent ?? null,
                cashback_share_fixed: t.cashback_share_fixed ?? null,
                cashbackGiven: Number(t.cashback_amount || 0),
                category: category ? { name: category.name, icon: category.icon } : null,
                cashback_entries: [],
            }
        })
    } catch (error) {
        console.error('Failed to fetch monthly cashback details:', error)
        return []
    }
}

/**
 * Maps TransactionWithDetails to CashbackTransaction by resolving the cashback
 * policy for each transaction's category against the account's cashback config.
 * The account must be pre-loaded with augmented cb_rules_json (which includes
 * both UUID and PocketBase IDs in cat_ids) to ensure correct policy matching.
 */
function mapToCashbackTransactions(
    txns: TransactionWithDetails[],
    account: Awaited<ReturnType<typeof getPocketBaseAccountDetails>>,
    cycleSpent: number,
): CashbackTransaction[] {
    if (!account) return []

    return txns.map((t): CashbackTransaction => {
        const txnAmount = Math.abs(t.amount ?? 0)

        const resolvedPolicy = resolveCashbackPolicy({
            account: account as any,
            categoryId: t.category_id ?? undefined,
            amount: txnAmount,
            cycleTotals: { spent: cycleSpent },
            categoryName: t.category_name ?? undefined,
        })

        const policyMetadata = normalizePolicyMetadata(resolvedPolicy.metadata)
        const policyRate = policyMetadata?.rate ?? 0

        // Use stored cashback_share_percent if present, otherwise policy rate
        const sharePercent = t.cashback_share_percent ?? policyRate
        const shareFixed = t.cashback_share_fixed ?? 0

        // Compute bank back: policy rate × amount, capped by rule max reward
        let bankBack = txnAmount * policyRate
        const ruleMaxReward = policyMetadata?.ruleMaxReward ?? resolvedPolicy.maxReward ?? null
        if (ruleMaxReward !== null && ruleMaxReward > 0) {
            bankBack = Math.min(bankBack, ruleMaxReward)
        }

        // If transaction has a stored cashback amount (real mode), prefer that
        const storedCashback = t.cashback_share_amount
        if (typeof storedCashback === 'number' && storedCashback > 0) {
            bankBack = storedCashback
        }

        const peopleBack = shareFixed > 0 ? shareFixed : txnAmount * sharePercent
        const profit = bankBack - peopleBack

        return {
            id: t.id,
            occurred_at: t.occurred_at ?? t.date ?? new Date().toISOString(),
            note: t.note ?? null,
            amount: t.amount ?? 0,
            earned: bankBack,
            bankBack,
            peopleBack,
            profit,
            effectiveRate: policyRate,
            sharePercent: t.cashback_share_percent ?? undefined,
            shareFixed: shareFixed > 0 ? shareFixed : undefined,
            shopName: t.shop_name ?? undefined,
            shopLogoUrl: t.shop_image_url ?? null,
            categoryName: t.category_name ?? undefined,
            categoryIcon: t.category_icon ?? null,
            categoryLogoUrl: t.category_image_url ?? null,
            personName: t.person_name ?? null,
            policyMetadata: policyMetadata ?? undefined,
            cycleTag: t.persisted_cycle_tag ?? null,
        }
    })
}

export async function fetchAccountCycleTransactions(
    accountId: string,
    cycleId?: string,
    cycleTag?: string,
    statementDay?: number | null,
    cycleType?: string | null
): Promise<CashbackTransaction[]> {
    try {
        let rawTxns: TransactionWithDetails[] = []

        if (cycleTag) {
            rawTxns = await getPocketBaseCycleTransactions(accountId, cycleTag)
        } else if (cycleId) {
            const options = await getPocketBaseAccountCycleOptions(accountId, 48)
            const matched = options.find((option) => option.cycleId === cycleId)
            if (matched?.tag) {
                rawTxns = await getPocketBaseCycleTransactions(accountId, matched.tag)
            }
        }

        if (rawTxns.length === 0) return []

        // Load the account to resolve cashback policies (with augmented cb_rules_json)
        const account = await getPocketBaseAccountDetails(accountId)
        if (!account || account.type !== 'credit_card') {
            // Fallback: return minimal CashbackTransaction objects without policy resolution
            return rawTxns.map((t): CashbackTransaction => ({
                id: t.id,
                occurred_at: t.occurred_at ?? t.date ?? new Date().toISOString(),
                note: t.note ?? null,
                amount: t.amount ?? 0,
                earned: 0,
                bankBack: 0,
                peopleBack: 0,
                profit: 0,
                effectiveRate: 0,
                categoryName: t.category_name ?? undefined,
                categoryIcon: t.category_icon ?? null,
                personName: t.person_name ?? null,
                cycleTag: t.persisted_cycle_tag ?? null,
            }))
        }

        return mapToCashbackTransactions(rawTxns, account, 0)
    } catch (error) {
        console.error('Failed to fetch account cycle transactions:', error)
        return []
    }
}

export async function fetchAccountCyclesAction(accountId: string): Promise<any[]> {
    try {
        return await getPocketBaseAccountCycleOptions(accountId, 48)
    } catch (error) {
        console.error('Failed to fetch account cycles:', error)
        return []
    }
}

export async function fetchAccountCycleOptionsAction(accountId: string) {
    try {
        const options = await getPocketBaseAccountCycleOptions(accountId);

        return (options as any[]).map(opt => {
            return {
                tag: opt.tag,
                label: opt.label,
                cycleType: opt.cycleType ?? null,
                statementDay: opt.statementDay ?? null,
                cycleId: opt.cycleId ?? null,
                stats: opt.stats
                    ? {
                        spent_amount: opt.stats.spent_amount,
                        real_awarded: opt.stats.real_awarded,
                        virtual_profit: opt.stats.virtual_profit,
                    }
                    : undefined,
            };
        });
    } catch (error) {
        console.error('Failed to fetch account cycle options:', error);
        return [];
    }
}

