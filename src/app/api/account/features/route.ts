import {mailConfigured} from '../../../../server/mail';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({emailDeliveryEnabled: mailConfigured(),
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
    signUpEnabled: process.env.ALLOW_SIGNUP === 'true'}, {headers: {'Cache-Control': 'no-store'}});
}
