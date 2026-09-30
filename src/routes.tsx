/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 commercetools GmbH and the ct-builders contributors
 * Freely available, AS IS and UNSUPPORTED. See LICENSE.
 */

import { Switch, Route } from 'react-router-dom';
import DeployScreen from './components/deploy/deploy-screen';

const ApplicationRoutes = () => (
  // Wide container: these tables are read on a shared screen in a review
  // meeting, so the content uses the width it is given.
  <div style={{ padding: '20px 24px 40px', maxWidth: 1600 }}>
    <Switch>
      <Route>
        <DeployScreen />
      </Route>
    </Switch>
  </div>
);
ApplicationRoutes.displayName = 'ApplicationRoutes';

export default ApplicationRoutes;
